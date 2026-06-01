import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same subprocess pattern as src/lib/linkedin/ingest.test.ts — the script
// writes to its DB at module load, so each test spawns a fresh subprocess
// with STRAND_DB_PATH pointing at a per-test temp file.

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const RESULT_MARKER = "__REPAIR_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-repair-test-"));
  const dbPath = join(dir, "test.db");
  const proc = Bun.spawn(["bun", "run", "src/lib/db/migrate.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, STRAND_DB_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`migrate failed (${exitCode}):\n${stderr}`);
  }
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function runSubprocessScript<T = unknown>(
  dbPath: string,
  script: string,
): Promise<T> {
  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: REPO_ROOT,
    env: { ...process.env, STRAND_DB_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    throw new Error(`subprocess exited ${exitCode}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
  }
  const line = stdout.split("\n").reverse().find((l) => l.startsWith(RESULT_MARKER));
  if (!line) throw new Error(`no ${RESULT_MARKER} in:\n${stdout}\nSTDERR:\n${stderr}`);
  return JSON.parse(line.slice(RESULT_MARKER.length)) as T;
}

describe("repair-owner-orphans — synthetic orphan state is fully rewritten", () => {
  let before: {
    connectionsFromOld: number;
    positionsOnOld: number;
    manualEdgesWithOld: number;
    strandedRowExists: boolean;
  };
  let dryRunStdout: string;
  let applyStdout: string;
  let after: {
    connectionsFromOld: number;
    connectionsFromNew: number;
    positionsOnOld: number;
    positionsOnNew: number;
    manualEdgesWithOld: number;
    manualEdgesWithNew: number;
    strandedRowExists: boolean;
    newOwnerRowExists: boolean;
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;

    // 1. Seed an orphan state: 2 owner rows, tenant.ownerPersonId = NEW,
    //    but every FK still references OLD (the pre-v0.4.2 bug).
    before = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { eq, sql } = await import("drizzle-orm");
        const now = new Date();
        const tenantId = LOCAL_TENANT_ID;

        await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
        await db.insert(schema.exportBatches).values({
          id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
          filename: "x.zip", sha256: "x".repeat(64),
        });

        // OLD owner row (will be stranded after we set tenant to NEW below).
        await db.insert(schema.people).values({
          id: "owner-old", tenantId, fullName: "Alice", headline: null, email: null,
          linkedinUrl: null, sourceBatchId: "batch-1", firstSeen: now, lastSeen: now,
        });
        // NEW owner row (per tenants.ownerPersonId after the rename re-ingest).
        await db.insert(schema.people).values({
          id: "owner-new", tenantId, fullName: "Alice Smith", headline: "Senior Engineer", email: null,
          linkedinUrl: null, sourceBatchId: "batch-1", firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.people).values({
          id: "peer-1", tenantId, fullName: "Bob Peer", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/bob", sourceBatchId: "batch-1", firstSeen: now, lastSeen: now,
        });

        // The bug state: tenant points at NEW but every FK still references OLD.
        await db.update(schema.tenants).set({ ownerPersonId: "owner-new" }).where(eq(schema.tenants.id, tenantId));

        await db.insert(schema.connections).values({
          tenantId, fromPersonId: "owner-old", toPersonId: "peer-1",
          source: "linkedin", connectedAt: "2024-01-01",
        });

        await db.insert(schema.companies).values({
          id: "co-1", tenantId, name: "Acme", normalizedName: "acme",
        });
        await db.insert(schema.positions).values({
          id: "pos-1", tenantId, personId: "owner-old", companyId: "co-1",
          title: "Eng", startDate: "2020-01", endDate: null, current: true, origin: "declared",
        });

        const [a, b] = ["owner-old", "peer-1"].sort();
        await db.insert(schema.manualEdges).values({
          tenantId, personA: a, personB: b, note: "test edge", assertedAt: now,
        });

        const countOne = async (q) => Number((await db.all(q))[0].n);
        console.log("${RESULT_MARKER}" + JSON.stringify({
          connectionsFromOld: await countOne(sql\`SELECT COUNT(*) AS n FROM connections WHERE from_person_id = 'owner-old'\`),
          positionsOnOld: await countOne(sql\`SELECT COUNT(*) AS n FROM positions WHERE person_id = 'owner-old'\`),
          manualEdgesWithOld: await countOne(sql\`SELECT COUNT(*) AS n FROM manual_edges WHERE person_a = 'owner-old' OR person_b = 'owner-old'\`),
          strandedRowExists: (await db.select().from(schema.people).where(eq(schema.people.id, "owner-old")).limit(1)).length > 0,
        }));
      `,
    );

    // 2. Dry-run pass — should detect 1 stranded owner and NOT mutate.
    const dryProc = Bun.spawn(
      ["bun", "run", "scripts/repair-owner-orphans.ts"],
      { cwd: REPO_ROOT, env: { ...process.env, STRAND_DB_PATH: fresh.dbPath }, stdout: "pipe", stderr: "pipe" },
    );
    const dryExit = await dryProc.exited;
    dryRunStdout = await new Response(dryProc.stdout).text();
    if (dryExit !== 0) throw new Error(`dry-run failed (${dryExit})\n${dryRunStdout}`);

    // 3. Apply pass — should perform the rewrite + re-derive.
    const applyProc = Bun.spawn(
      ["bun", "run", "scripts/repair-owner-orphans.ts", "--apply"],
      { cwd: REPO_ROOT, env: { ...process.env, STRAND_DB_PATH: fresh.dbPath }, stdout: "pipe", stderr: "pipe" },
    );
    const applyExit = await applyProc.exited;
    applyStdout = await new Response(applyProc.stdout).text();
    if (applyExit !== 0) throw new Error(`apply failed (${applyExit})\n${applyStdout}`);

    // 4. Post-repair invariants.
    after = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { eq, sql } = await import("drizzle-orm");
        const countOne = async (q) => Number((await db.all(q))[0].n);
        console.log("${RESULT_MARKER}" + JSON.stringify({
          connectionsFromOld: await countOne(sql\`SELECT COUNT(*) AS n FROM connections WHERE from_person_id = 'owner-old'\`),
          connectionsFromNew: await countOne(sql\`SELECT COUNT(*) AS n FROM connections WHERE from_person_id = 'owner-new'\`),
          positionsOnOld: await countOne(sql\`SELECT COUNT(*) AS n FROM positions WHERE person_id = 'owner-old'\`),
          positionsOnNew: await countOne(sql\`SELECT COUNT(*) AS n FROM positions WHERE person_id = 'owner-new'\`),
          manualEdgesWithOld: await countOne(sql\`SELECT COUNT(*) AS n FROM manual_edges WHERE person_a = 'owner-old' OR person_b = 'owner-old'\`),
          manualEdgesWithNew: await countOne(sql\`SELECT COUNT(*) AS n FROM manual_edges WHERE person_a = 'owner-new' OR person_b = 'owner-new'\`),
          strandedRowExists: (await db.select().from(schema.people).where(eq(schema.people.id, "owner-old")).limit(1)).length > 0,
          newOwnerRowExists: (await db.select().from(schema.people).where(eq(schema.people.id, "owner-new")).limit(1)).length > 0,
        }));
      `,
    );
  }, 120_000);

  test("seed: orphan state is set up correctly before running the script", () => {
    expect(before.connectionsFromOld).toBe(1);
    expect(before.positionsOnOld).toBe(1);
    expect(before.manualEdgesWithOld).toBe(1);
    expect(before.strandedRowExists).toBe(true);
  });

  test("dry-run: reports 1 stranded owner without mutating", () => {
    expect(dryRunStdout).toContain("1 stranded owner(s) detected");
    expect(dryRunStdout).toContain("(dry-run — re-run with --apply to mutate)");
  });

  test("apply: connections.from_person_id rewritten old → new", () => {
    expect(after.connectionsFromOld).toBe(0);
    expect(after.connectionsFromNew).toBe(1);
  });

  test("apply: positions.person_id rewritten old → new", () => {
    expect(after.positionsOnOld).toBe(0);
    expect(after.positionsOnNew).toBe(1);
  });

  test("apply: manual_edges re-canonicalised onto new owner id", () => {
    expect(after.manualEdgesWithOld).toBe(0);
    expect(after.manualEdgesWithNew).toBe(1);
  });

  test("apply: stranded people row deleted", () => {
    expect(after.strandedRowExists).toBe(false);
  });

  test("apply: current owner row still present", () => {
    expect(after.newOwnerRowExists).toBe(true);
  });

  test("apply: script reports 1 stranded owner repaired", () => {
    expect(applyStdout).toContain("1 stranded owner(s) repaired");
  });
});
