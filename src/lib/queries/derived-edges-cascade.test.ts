import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cascade regression for the v0.4.7 PK change (companyId added to
// derived_edges PK). Three consumer surfaces broke and are fixed here:
//   1) assembleNetworkGraph — Cytoscape edge IDs `d:a:b:kind` collided
//      when a pair shared 2 companies under the same kind; the second
//      edge was silently dropped, degree was double-bumped.
//   2) personInspector.edgeCounts — COUNT(*) inflated per (pair, company)
//      rows; switched to COUNT(DISTINCT colleague).
//   3) listDerivedEdgesForPerson — returned 1 row per (other, kind, company)
//      so a colleague at multiple employers appeared multiple times in the
//      Derived Connections list; switched to ROW_NUMBER()=1 per (other, kind),
//      picking the strongest row (confidence DESC, overlap_months DESC).

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const RESULT_MARKER = "__CASCADE_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-cascade-test-"));
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
  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runSubprocessScript<T = unknown>(dbPath: string, script: string): Promise<T> {
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

// Shared seed: owner Alice + connection Bob, declared overlap at Google
// 2018-2022 AND at Microsoft 2022-2024 — both rows land as kind
// `shared_employer_overlap` with confidence 0.9. Pre-fix this produces
// the collision; post-fix the consumers handle the two rows correctly.
const SEED_PRELUDE = /* js */ `
  const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
  const { deriveSharedEmployerEdges } = await import("${REPO_ROOT}/src/lib/derived/edges.ts");
  const { assembleNetworkGraph } = await import("${REPO_ROOT}/src/lib/queries/graph.ts");
  const { getPersonInspector } = await import("${REPO_ROOT}/src/lib/queries/personInspector.ts");
  const { listDerivedEdgesForPerson } = await import("${REPO_ROOT}/src/lib/queries/derivedEdges.ts");
  const { sql } = await import("drizzle-orm");
  const tenantId = LOCAL_TENANT_ID;
  const now = new Date("2026-05-01T00:00:00Z");

  await db.insert(schema.tenants)
    .values({ id: tenantId, createdAt: now, ownerPersonId: "alice" })
    .onConflictDoUpdate({
      target: schema.tenants.id,
      set: { ownerPersonId: "alice" },
    });
  await db.insert(schema.exportBatches).values({
    id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
    filename: "x.zip", sha256: "x".repeat(64),
  });
  await db.insert(schema.people).values([
    { id: "alice", tenantId, fullName: "Alice", headline: null, email: null,
      linkedinUrl: "https://linkedin.com/in/alice", sourceBatchId: "batch-1",
      firstSeen: now, lastSeen: now },
    { id: "bob",   tenantId, fullName: "Bob",   headline: null, email: null,
      linkedinUrl: "https://linkedin.com/in/bob",   sourceBatchId: "batch-1",
      firstSeen: now, lastSeen: now },
  ]);
  await db.insert(schema.connections).values({
    tenantId,
    fromPersonId: "alice",
    toPersonId: "bob",
    source: "linkedin",
    connectedAt: "2018-01-01",
  });
  await db.insert(schema.companies).values([
    { id: "co-google",    tenantId, name: "Google",    normalizedName: "google" },
    { id: "co-microsoft", tenantId, name: "Microsoft", normalizedName: "microsoft" },
  ]);
  await db.insert(schema.positions).values([
    { id: "pos-1", tenantId, personId: "alice", companyId: "co-google",    title: "SWE", startDate: "2018-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-2", tenantId, personId: "bob",   companyId: "co-google",    title: "SWE", startDate: "2019-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-3", tenantId, personId: "alice", companyId: "co-microsoft", title: "PM",  startDate: "2022-06-01", endDate: "2024-06-01", current: false, origin: "declared" },
    { id: "pos-4", tenantId, personId: "bob",   companyId: "co-microsoft", title: "PM",  startDate: "2023-01-01", endDate: "2024-06-01", current: false, origin: "declared" },
  ]);
  await deriveSharedEmployerEdges(tenantId, now);
`;

describe("derived_edges PK cascade — graph + inspector + list (audit follow-up to #3)", () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => { for (const c of cleanups) c(); });

  test("assembleNetworkGraph emits 2 distinct edge IDs for a pair sharing 2 companies under same kind", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      edgeIds: string[];
      derivedEdgesAliceBob: number;
      aliceDegree: number;
      bobDegree: number;
    }>(fresh.dbPath, SEED_PRELUDE + /* js */ `
      // minConfidence floor at 0.7 to admit both overlap edges (confidence 0.9).
      const g = await assembleNetworkGraph(tenantId, { minConfidence: 0.7 });
      const derivedEdgesAliceBob = g.edges.filter(
        (e) => e.kind !== "manual" &&
               ((e.source === "alice" && e.target === "bob") ||
                (e.source === "bob"   && e.target === "alice"))
      );
      const alice = g.nodes.find((n) => n.id === "alice");
      const bob   = g.nodes.find((n) => n.id === "bob");
      console.log("${RESULT_MARKER}" + JSON.stringify({
        edgeIds: derivedEdgesAliceBob.map((e) => e.id),
        derivedEdgesAliceBob: derivedEdgesAliceBob.length,
        aliceDegree: alice?.degree ?? -1,
        bobDegree: bob?.degree ?? -1,
      }));
      process.exit(0);
    `);

    // Pre-fix: 1 edge survives (Cytoscape would drop the duplicate ID).
    // Post-fix: 2 distinct edge IDs for the pair (one per company).
    expect(out.derivedEdgesAliceBob).toBe(2);
    expect(new Set(out.edgeIds).size).toBe(2);
    expect(out.edgeIds.every((id) => id.startsWith("d:alice:bob:shared_employer_overlap:"))).toBe(true);

    // Degree dedup per (a, b) pair across companies: each node counted once
    // for the Alice↔Bob relationship, NOT twice (which the old code did and
    // distorted the minDegree filter).
    expect(out.aliceDegree).toBe(1);
    expect(out.bobDegree).toBe(1);
  }, 60_000);

  test("getPersonInspector.edgeCounts.derivedOverlap counts unique colleagues, not (colleague, company) rows", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      aliceDerivedOverlap: number;
      bobDerivedOverlap: number;
    }>(fresh.dbPath, SEED_PRELUDE + /* js */ `
      const aliceInspector = await getPersonInspector("alice", tenantId);
      const bobInspector   = await getPersonInspector("bob",   tenantId);
      console.log("${RESULT_MARKER}" + JSON.stringify({
        aliceDerivedOverlap: aliceInspector?.edgeCounts.derivedOverlap ?? -1,
        bobDerivedOverlap:   bobInspector?.edgeCounts.derivedOverlap   ?? -1,
      }));
      process.exit(0);
    `);

    // Pre-fix: COUNT(*) = 2 (one row per (pair, company)).
    // Post-fix: COUNT(DISTINCT colleague) = 1 (Alice has 1 derived-overlap
    // colleague — Bob — even though they share two employers).
    expect(out.aliceDerivedOverlap).toBe(1);
    expect(out.bobDerivedOverlap).toBe(1);
  }, 60_000);

  test("listDerivedEdgesForPerson returns one row per (other, kind), strongest-by-confidence wins", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      rows: Array<{
        otherPersonId: string;
        kind: string;
        companyId: string | null;
        confidence: number;
      }>;
    }>(fresh.dbPath, SEED_PRELUDE + /* js */ `
      const rows = await listDerivedEdgesForPerson("alice", tenantId);
      console.log("${RESULT_MARKER}" + JSON.stringify({
        rows: rows.map((r) => ({
          otherPersonId: r.otherPersonId,
          kind: r.kind,
          companyId: r.companyId,
          confidence: r.confidence,
        })),
      }));
      process.exit(0);
    `);

    // Pre-fix: 2 rows for Bob (one per company).
    // Post-fix: 1 row for Bob — the strongest (highest confidence; ties broken
    // by overlap_months DESC). Both companies tie at 0.9 confidence; Google's
    // overlap is 36 months vs Microsoft's 24 months → Google wins.
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].otherPersonId).toBe("bob");
    expect(out.rows[0].kind).toBe("shared_employer_overlap");
    expect(out.rows[0].companyId).toBe("co-google");
  }, 60_000);
});
