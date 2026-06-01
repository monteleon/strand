import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Subprocess pattern (same as ingest.test.ts / repair-owner-orphans.test.ts) —
// each test seeds a synthetic positions row set against a temp DB with
// STRAND_DB_PATH, then runs getPersonInspector and reports the picked
// company. The /code-review finding (#6) is that personInspector's
// ORDER BY chain previously stopped at `start_date DESC` without the
// `po.id ASC` tiebreaker, so on identical (origin, current, start_date)
// the inspector returned a nondeterministic row that could disagree with
// /graph (which DOES include po.id ASC). Post-fix the inspector picks
// the lex-smallest position id deterministically.

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const RESULT_MARKER = "__INSPECTOR_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-inspector-test-"));
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

describe("getPersonInspector — deterministic tiebreaker on identical position ordering (v0.4.4, /code-review #6)", () => {
  let picked: { companyName: string | null; lexSmallerId: string; lexLargerId: string };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    picked = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { getPersonInspector } = await import("${REPO_ROOT}/src/lib/queries/personInspector.ts");
        const now = new Date();
        const tenantId = LOCAL_TENANT_ID;

        // Tenant + a batch + a non-owner person and two companies. Owner
        // identity isn't relevant to this test — the inspector picks the
        // ORDER BY [0] row regardless of owner.
        await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
        await db.insert(schema.exportBatches).values({
          id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
          filename: "x.zip", sha256: "x".repeat(64),
        });
        await db.insert(schema.people).values({
          id: "person-1", tenantId, fullName: "Test Person", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/test", sourceBatchId: "batch-1",
          firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.companies).values([
          { id: "co-alpha", tenantId, name: "Alpha Inc", normalizedName: "alpha inc" },
          { id: "co-beta", tenantId, name: "Beta Corp", normalizedName: "beta corp" },
        ]);

        // Two declared CURRENT positions with the SAME start_date — only
        // difference is the position id. Pre-fix ORDER BY chain stopped at
        // start_date DESC, so SQLite would return either row arbitrarily.
        // Post-fix \`po.id ASC\` makes the lex-smallest id win deterministically.
        // Position ids: "pos-aaa" (lex-smaller) vs "pos-bbb" (lex-larger).
        // Companies are deliberately wired so the lex-smaller id points at Alpha.
        await db.insert(schema.positions).values([
          {
            id: "pos-aaa", tenantId, personId: "person-1", companyId: "co-alpha",
            title: "Engineer", startDate: "2024-01-01", endDate: null,
            current: true, origin: "declared",
          },
          {
            id: "pos-bbb", tenantId, personId: "person-1", companyId: "co-beta",
            title: "Engineer", startDate: "2024-01-01", endDate: null,
            current: true, origin: "declared",
          },
        ]);

        const inspector = await getPersonInspector("person-1");
        console.log("${RESULT_MARKER}" + JSON.stringify({
          companyName: inspector?.current?.companyName ?? null,
          lexSmallerId: "pos-aaa",
          lexLargerId: "pos-bbb",
        }));
      `,
    );
  }, 60_000);

  test("inspector picks the lex-smallest position id on a (origin, current, start_date) tie", () => {
    // Alpha is the company on pos-aaa (lex-smaller id) — the post-fix winner.
    expect(picked.companyName).toBe("Alpha Inc");
  });
});

describe("getPersonInspector — single-position trivial cases (regression-safe)", () => {
  let result: {
    soloPicked: string | null;
    currentBeatsPast: string | null;
    declaredBeatsSynthesised: string | null;
    laterStartBeatsEarlier: string | null;
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    result = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { getPersonInspector } = await import("${REPO_ROOT}/src/lib/queries/personInspector.ts");
        const now = new Date();
        const tenantId = LOCAL_TENANT_ID;

        await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
        await db.insert(schema.exportBatches).values({
          id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
          filename: "x.zip", sha256: "x".repeat(64),
        });
        await db.insert(schema.companies).values([
          { id: "co-alpha", tenantId, name: "Alpha", normalizedName: "alpha" },
          { id: "co-beta", tenantId, name: "Beta", normalizedName: "beta" },
        ]);

        // Person A — one position (solo, no ranking ambiguity).
        await db.insert(schema.people).values({
          id: "person-solo", tenantId, fullName: "Solo", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/solo", sourceBatchId: "batch-1",
          firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.positions).values({
          id: "pos-solo", tenantId, personId: "person-solo", companyId: "co-alpha",
          title: "Eng", startDate: "2020-01-01", endDate: null, current: true, origin: "declared",
        });

        // Person B — past at Alpha, current at Beta. current=true should win.
        await db.insert(schema.people).values({
          id: "person-current", tenantId, fullName: "Current", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/current", sourceBatchId: "batch-1",
          firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.positions).values([
          { id: "pos-past", tenantId, personId: "person-current", companyId: "co-alpha",
            title: "Eng", startDate: "2018-01-01", endDate: "2020-01-01", current: false, origin: "declared" },
          { id: "pos-curr", tenantId, personId: "person-current", companyId: "co-beta",
            title: "Eng", startDate: "2021-01-01", endDate: null, current: true, origin: "declared" },
        ]);

        // Person C — declared past at Alpha, synthesised current at Beta. Declared wins.
        await db.insert(schema.people).values({
          id: "person-decl", tenantId, fullName: "Decl", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/decl", sourceBatchId: "batch-1",
          firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.positions).values([
          { id: "pos-decl-past", tenantId, personId: "person-decl", companyId: "co-alpha",
            title: "Eng", startDate: "2018-01-01", endDate: "2020-01-01", current: false, origin: "declared" },
          { id: "pos-synth-curr", tenantId, personId: "person-decl", companyId: "co-beta",
            title: "Eng", startDate: null, endDate: null, current: true, origin: "synthesised" },
        ]);

        // Person D — two declared current positions, different start dates. Later start wins.
        await db.insert(schema.people).values({
          id: "person-later", tenantId, fullName: "Later", headline: null, email: null,
          linkedinUrl: "https://linkedin.com/in/later", sourceBatchId: "batch-1",
          firstSeen: now, lastSeen: now,
        });
        await db.insert(schema.positions).values([
          { id: "pos-early", tenantId, personId: "person-later", companyId: "co-alpha",
            title: "Eng", startDate: "2020-01-01", endDate: null, current: true, origin: "declared" },
          { id: "pos-late", tenantId, personId: "person-later", companyId: "co-beta",
            title: "Eng", startDate: "2024-01-01", endDate: null, current: true, origin: "declared" },
        ]);

        const solo = await getPersonInspector("person-solo");
        const curr = await getPersonInspector("person-current");
        const decl = await getPersonInspector("person-decl");
        const later = await getPersonInspector("person-later");

        console.log("${RESULT_MARKER}" + JSON.stringify({
          soloPicked: solo?.current?.companyName ?? null,
          currentBeatsPast: curr?.current?.companyName ?? null,
          declaredBeatsSynthesised: decl?.current?.companyName ?? null,
          laterStartBeatsEarlier: later?.current?.companyName ?? null,
        }));
      `,
    );
  }, 60_000);

  test("solo position → that company", () => {
    expect(result.soloPicked).toBe("Alpha");
  });

  test("current=true outranks current=false", () => {
    expect(result.currentBeatsPast).toBe("Beta");
  });

  test("origin=declared outranks origin=synthesised", () => {
    expect(result.declaredBeatsSynthesised).toBe("Alpha");
  });

  test("later start_date outranks earlier when both current and declared", () => {
    expect(result.laterStartBeatsEarlier).toBe("Beta");
  });
});
