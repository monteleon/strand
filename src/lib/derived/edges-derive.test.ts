import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Subprocess pattern (same as ingest.test.ts / personInspector.test.ts):
// deriveSharedEmployerEdges writes to the DB indicated by STRAND_DB_PATH,
// and the rest of the test suite runs against the real `data/strand.db`.
// Per-test temp DB, migrate, seed, derive, probe, exit.
const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const RESULT_MARKER = "__DERIVE_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-derive-test-"));
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
    throw new Error(
      `subprocess exited ${exitCode}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
    );
  }
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(RESULT_MARKER));
  if (!line) {
    throw new Error(
      `no ${RESULT_MARKER} line in subprocess stdout:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }
  return JSON.parse(line.slice(RESULT_MARKER.length)) as T;
}

// Shared seed prelude: tenants → batch → people (alice, bob) → companies.
// All scenarios start from a fresh, empty DB created by freshDbWithMigrations.
const SEED_PRELUDE = /* js */ `
  const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
  const { deriveSharedEmployerEdges } = await import("${REPO_ROOT}/src/lib/derived/edges.ts");
  const { sql } = await import("drizzle-orm");
  const tenantId = LOCAL_TENANT_ID;
  const now = new Date("2026-05-01T00:00:00Z");

  await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
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
`;

// Scenario 1 — Alice & Bob share TWO companies (Google + Microsoft), both
// with substantial overlap. Pre-fix, the second company's row collided on
// PK (tenant, a, b, kind) and was silently dropped via onConflictDoNothing.
// Post-fix, both must land — one row per (a, b, kind, company).
const SEED_SCRIPT_TWO_COMPANIES = SEED_PRELUDE + /* js */ `
  await db.insert(schema.companies).values([
    { id: "co-google",    tenantId, name: "Google",    normalizedName: "google" },
    { id: "co-microsoft", tenantId, name: "Microsoft", normalizedName: "microsoft" },
  ]);
  await db.insert(schema.positions).values([
    { id: "pos-1", tenantId, personId: "alice", companyId: "co-google",    title: "SWE", startDate: "2018-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-2", tenantId, personId: "bob",   companyId: "co-google",    title: "SWE", startDate: "2019-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-3", tenantId, personId: "alice", companyId: "co-microsoft", title: "PM",  startDate: "2022-06-01", endDate: null,         current: true,  origin: "declared" },
    { id: "pos-4", tenantId, personId: "bob",   companyId: "co-microsoft", title: "PM",  startDate: "2023-01-01", endDate: null,         current: true,  origin: "declared" },
  ]);

  const result = await deriveSharedEmployerEdges(tenantId, now);
  const rows = await db.all(sql\`
    SELECT person_a, person_b, kind, company_id, confidence,
           json_extract(evidence_json, '$.companyId')   AS evidence_company_id,
           json_extract(evidence_json, '$.companyName') AS evidence_company_name
    FROM derived_edges
    WHERE tenant_id = \${tenantId} AND person_a = 'alice' AND person_b = 'bob'
    ORDER BY company_id ASC
  \`);
  console.log("${RESULT_MARKER}" + JSON.stringify({
    deriveResult: result,
    rowsForPair: rows.map((r) => ({
      personA: r.person_a, personB: r.person_b, kind: r.kind,
      companyId: r.company_id, evidenceCompanyId: r.evidence_company_id,
      evidenceCompanyName: r.evidence_company_name, confidence: r.confidence,
    })),
  }));
  process.exit(0);
`;

// Scenario 2 — single shared company. Sanity: PK fix must not double-insert.
const SEED_SCRIPT_ONE_COMPANY = SEED_PRELUDE + /* js */ `
  await db.insert(schema.companies).values([
    { id: "co-google", tenantId, name: "Google", normalizedName: "google" },
  ]);
  await db.insert(schema.positions).values([
    { id: "pos-1", tenantId, personId: "alice", companyId: "co-google", title: "SWE", startDate: "2018-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-2", tenantId, personId: "bob",   companyId: "co-google", title: "SWE", startDate: "2019-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
  ]);

  await deriveSharedEmployerEdges(tenantId, now);
  const rows = await db.all(sql\`
    SELECT person_a, person_b, kind, company_id, confidence
    FROM derived_edges
    WHERE tenant_id = \${tenantId} AND person_a = 'alice' AND person_b = 'bob'
  \`);
  console.log("${RESULT_MARKER}" + JSON.stringify({
    rowsForPair: rows.map((r) => ({
      personA: r.person_a, personB: r.person_b, kind: r.kind,
      companyId: r.company_id, confidence: r.confidence,
    })),
  }));
  process.exit(0);
`;

// Scenario 3 — re-derive idempotency. Clear-then-rebuild contract must hold
// under the wider PK; row count must not drift across runs.
const SEED_SCRIPT_IDEMPOTENT = SEED_PRELUDE + /* js */ `
  await db.insert(schema.companies).values([
    { id: "co-google",    tenantId, name: "Google",    normalizedName: "google" },
    { id: "co-microsoft", tenantId, name: "Microsoft", normalizedName: "microsoft" },
  ]);
  await db.insert(schema.positions).values([
    { id: "pos-1", tenantId, personId: "alice", companyId: "co-google",    title: "SWE", startDate: "2018-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-2", tenantId, personId: "bob",   companyId: "co-google",    title: "SWE", startDate: "2019-01-01", endDate: "2022-01-01", current: false, origin: "declared" },
    { id: "pos-3", tenantId, personId: "alice", companyId: "co-microsoft", title: "PM",  startDate: "2022-06-01", endDate: null,         current: true,  origin: "declared" },
    { id: "pos-4", tenantId, personId: "bob",   companyId: "co-microsoft", title: "PM",  startDate: "2023-01-01", endDate: null,         current: true,  origin: "declared" },
  ]);

  const first  = await deriveSharedEmployerEdges(tenantId, now);
  const second = await deriveSharedEmployerEdges(tenantId, now);
  const rowsAfter = await db.all(sql\`
    SELECT person_a, person_b, kind, company_id
    FROM derived_edges
    WHERE tenant_id = \${tenantId}
    ORDER BY company_id ASC
  \`);
  console.log("${RESULT_MARKER}" + JSON.stringify({
    firstKept: first.kept,
    secondKept: second.kept,
    rowsAfter: rowsAfter.map((r) => ({
      personA: r.person_a, personB: r.person_b, kind: r.kind, companyId: r.company_id,
    })),
  }));
  process.exit(0);
`;

describe("deriveSharedEmployerEdges — companyId in PK (finding #3)", () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => { for (const c of cleanups) c(); });

  test("pair sharing 2 employers lands as 2 rows, one per company", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      deriveResult: { kept: number; byKind: Record<string, number> };
      rowsForPair: Array<{
        personA: string;
        personB: string;
        kind: string;
        companyId: string;
        evidenceCompanyId: string;
        evidenceCompanyName: string;
        confidence: number;
      }>;
    }>(fresh.dbPath, SEED_SCRIPT_TWO_COMPANIES);

    // Pre-fix this is 1 (the second company's row was silently dropped via
    // PK collision on (tenant, a, b, kind) + onConflictDoNothing). Post-fix
    // both companies land — one row per (a, b, kind, company).
    expect(out.rowsForPair.length).toBe(2);

    const byCompany = new Map(out.rowsForPair.map((r) => [r.companyId, r]));
    expect(byCompany.has("co-google")).toBe(true);
    expect(byCompany.has("co-microsoft")).toBe(true);

    // The company_id column matches the companyId baked in evidence_json —
    // the new surface and the old single-source-of-truth never diverge.
    for (const r of out.rowsForPair) {
      expect(r.companyId).toBe(r.evidenceCompanyId);
    }

    // Both rows resolve to the SAME kind (shared_employer_overlap @ 0.9) —
    // Google via Jan-2019 → Jan-2022 = 36mo overlap; Microsoft via the
    // bothCurrent positions running long enough that overlap math also yields
    // ≥12mo (start 2023-01 → today 2026-05 = 40mo). This is the bug case
    // VERBATIM: two derived rows with identical (tenant, a, b, kind) and only
    // companyId distinguishing them. Pre-fix, the second insert collided and
    // was silently dropped via onConflictDoNothing.
    const google = byCompany.get("co-google")!;
    expect(google.kind).toBe("shared_employer_overlap");
    expect(google.confidence).toBe(0.9);
    const microsoft = byCompany.get("co-microsoft")!;
    expect(microsoft.kind).toBe("shared_employer_overlap");
    expect(microsoft.confidence).toBe(0.9);
  }, 60_000);

  test("pair sharing 1 employer lands as exactly 1 row", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      rowsForPair: Array<{ personA: string; personB: string; kind: string; companyId: string; confidence: number }>;
    }>(fresh.dbPath, SEED_SCRIPT_ONE_COMPANY);

    expect(out.rowsForPair.length).toBe(1);
    expect(out.rowsForPair[0].companyId).toBe("co-google");
    expect(out.rowsForPair[0].kind).toBe("shared_employer_overlap");
  }, 60_000);

  test("re-deriving the same seed is idempotent", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    const out = await runSubprocessScript<{
      firstKept: number;
      secondKept: number;
      rowsAfter: Array<{ personA: string; personB: string; kind: string; companyId: string }>;
    }>(fresh.dbPath, SEED_SCRIPT_IDEMPOTENT);

    expect(out.firstKept).toBe(out.secondKept);
    expect(out.rowsAfter.length).toBe(2);
    const companies = out.rowsAfter.map((r) => r.companyId).sort();
    expect(companies).toEqual(["co-google", "co-microsoft"]);
  }, 60_000);
});
