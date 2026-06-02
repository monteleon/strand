import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Subprocess-isolated query-layer regression for /code-review finding #7 —
// listCompanies / listPeople / searchPeople built LIKE patterns with raw
// user input, so a `q=%` request returned every row instead of just rows
// containing a literal `%`. searchCompanies already escaped (v0.4.0 patch).
// This test seeds a temp DB with rows that contain literal % and _ in their
// names so the assertions are observable.

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const RESULT_MARKER = "__LIKE_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-like-test-"));
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
  if (!line) throw new Error(`no ${RESULT_MARKER} line in subprocess stdout:\n${stdout}\nSTDERR:\n${stderr}`);
  return JSON.parse(line.slice(RESULT_MARKER.length)) as T;
}

// Seed: 3 companies and 4 people, mixing literal % / _ characters into names
// so the wildcard-vs-literal distinction is observable. An owner row is
// seeded so listPeople's exclude-owner path runs the same way as in prod.
const SEED_AND_PROBE = /* js */ `
  const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
  const { listCompanies, searchCompanies } = await import("${REPO_ROOT}/src/lib/queries/companies.ts");
  const { listPeople, searchPeople } = await import("${REPO_ROOT}/src/lib/queries/people.ts");
  const tenantId = LOCAL_TENANT_ID;
  const now = new Date("2026-05-01T00:00:00Z");

  await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
  await db.insert(schema.exportBatches).values({
    id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
    filename: "x.zip", sha256: "x".repeat(64),
  });

  // People — owner + three connections. Two of the connections carry literal
  // wildcards in their names; one is plain.
  await db.insert(schema.people).values([
    { id: "owner",        tenantId, fullName: "Owner Person",           headline: null, email: null, linkedinUrl: "https://linkedin.com/in/owner",     sourceBatchId: "batch-1", firstSeen: now, lastSeen: now },
    { id: "alice",        tenantId, fullName: "Alice Smith",            headline: null, email: null, linkedinUrl: "https://linkedin.com/in/alice",     sourceBatchId: "batch-1", firstSeen: now, lastSeen: now },
    { id: "bob-percent",  tenantId, fullName: "Bob 99%",                headline: null, email: null, linkedinUrl: "https://linkedin.com/in/bob",       sourceBatchId: "batch-1", firstSeen: now, lastSeen: now },
    { id: "c-underscore", tenantId, fullName: "C_Tester",               headline: null, email: null, linkedinUrl: "https://linkedin.com/in/c-tester",  sourceBatchId: "batch-1", firstSeen: now, lastSeen: now },
  ]);

  // tenant.owner_person_id so listPeople / searchPeople exclude the owner
  // exactly like in prod.
  await db.update(schema.tenants).set({ ownerPersonId: "owner" })
    .where((await import("drizzle-orm")).eq(schema.tenants.id, tenantId));

  // Companies — 3 rows, two with literal wildcard chars in their names.
  await db.insert(schema.companies).values([
    { id: "co-acme",    tenantId, name: "Acme Corp",     normalizedName: "acme corp" },
    { id: "co-percent", tenantId, name: "100% Real Co",  normalizedName: "100% real co" },
    { id: "co-under",   tenantId, name: "Test_Co",       normalizedName: "test_co" },
  ]);

  // Probes — each q is a single literal char (% or _) that pre-fix would
  // have matched every row. Post-fix it should match only the rows whose
  // names actually contain that literal character.
  const out = {
    searchCompanies_percent: await searchCompanies("%"),
    searchCompanies_underscore: await searchCompanies("_"),
    searchCompanies_plain: await searchCompanies("acme"),

    listCompanies_percent: (await listCompanies({ page: 1, q: "%" })).rows,
    listCompanies_underscore: (await listCompanies({ page: 1, q: "_" })).rows,
    listCompanies_plain: (await listCompanies({ page: 1, q: "acme" })).rows,
    listCompanies_none: (await listCompanies({ page: 1, q: "" })).rows,

    searchPeople_percent: await searchPeople("%"),
    searchPeople_underscore: await searchPeople("_"),
    searchPeople_plain: await searchPeople("alice"),

    listPeople_percent: (await listPeople({ page: 1, q: "%" })).rows.map((r) => ({ id: r.id, fullName: r.fullName })),
    listPeople_underscore: (await listPeople({ page: 1, q: "_" })).rows.map((r) => ({ id: r.id, fullName: r.fullName })),
    listPeople_plain: (await listPeople({ page: 1, q: "alice" })).rows.map((r) => ({ id: r.id, fullName: r.fullName })),
    listPeople_none: (await listPeople({ page: 1, q: "" })).rows.map((r) => ({ id: r.id, fullName: r.fullName })),
  };
  console.log("${RESULT_MARKER}" + JSON.stringify(out));
  process.exit(0);
`;

describe("LIKE wildcard escape — finding #7 (companies + people queries)", () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => { for (const c of cleanups) c(); });

  let probes: {
    searchCompanies_percent: Array<{ id: string; name: string }>;
    searchCompanies_underscore: Array<{ id: string; name: string }>;
    searchCompanies_plain: Array<{ id: string; name: string }>;
    listCompanies_percent: Array<{ id: string; name: string }>;
    listCompanies_underscore: Array<{ id: string; name: string }>;
    listCompanies_plain: Array<{ id: string; name: string }>;
    listCompanies_none: Array<{ id: string; name: string }>;
    searchPeople_percent: Array<{ id: string; fullName: string }>;
    searchPeople_underscore: Array<{ id: string; fullName: string }>;
    searchPeople_plain: Array<{ id: string; fullName: string }>;
    listPeople_percent: Array<{ id: string; fullName: string }>;
    listPeople_underscore: Array<{ id: string; fullName: string }>;
    listPeople_plain: Array<{ id: string; fullName: string }>;
    listPeople_none: Array<{ id: string; fullName: string }>;
  };

  test("seed + probe", async () => {
    const fresh = await freshDbWithMigrations();
    cleanups.push(fresh.cleanup);
    probes = await runSubprocessScript(fresh.dbPath, SEED_AND_PROBE);
    expect(probes).toBeDefined();
  }, 60_000);

  test("searchCompanies(%) returns only rows containing literal %", () => {
    expect(probes.searchCompanies_percent.map((r) => r.id)).toEqual(["co-percent"]);
  });

  test("searchCompanies(_) returns only rows containing literal _", () => {
    expect(probes.searchCompanies_underscore.map((r) => r.id)).toEqual(["co-under"]);
  });

  test("searchCompanies('acme') still finds Acme Corp (sanity — plain substring works)", () => {
    expect(probes.searchCompanies_plain.map((r) => r.id)).toContain("co-acme");
  });

  test("listCompanies(q=%) returns only the row containing literal % (pre-fix: all 3)", () => {
    expect(probes.listCompanies_percent.map((r) => r.id)).toEqual(["co-percent"]);
  });

  test("listCompanies(q=_) returns only the row containing literal _ (pre-fix: all 3)", () => {
    expect(probes.listCompanies_underscore.map((r) => r.id)).toEqual(["co-under"]);
  });

  test("listCompanies(q='acme') still finds Acme Corp (sanity)", () => {
    expect(probes.listCompanies_plain.map((r) => r.id)).toContain("co-acme");
  });

  test("listCompanies(q='') returns all 3 companies — unfiltered baseline", () => {
    expect(probes.listCompanies_none.length).toBe(3);
  });

  test("searchPeople(%) returns only the person whose name contains literal %", () => {
    expect(probes.searchPeople_percent.map((r) => r.id)).toEqual(["bob-percent"]);
  });

  test("searchPeople(_) returns only the person whose name contains literal _", () => {
    expect(probes.searchPeople_underscore.map((r) => r.id)).toEqual(["c-underscore"]);
  });

  test("searchPeople('alice') still finds Alice Smith (sanity)", () => {
    expect(probes.searchPeople_plain.map((r) => r.id)).toContain("alice");
  });

  test("listPeople(q=%) returns only the person whose name contains literal % (pre-fix: all 3 non-owners)", () => {
    expect(probes.listPeople_percent.map((r) => r.id)).toEqual(["bob-percent"]);
  });

  test("listPeople(q=_) returns only the person whose name contains literal _ (pre-fix: all 3 non-owners)", () => {
    expect(probes.listPeople_underscore.map((r) => r.id)).toEqual(["c-underscore"]);
  });

  test("listPeople(q='alice') still finds Alice Smith (sanity)", () => {
    expect(probes.listPeople_plain.map((r) => r.id)).toContain("alice");
  });

  test("listPeople(q='') returns all non-owner people — owner excluded", () => {
    expect(probes.listPeople_none.length).toBe(3);
    expect(probes.listPeople_none.map((r) => r.id).sort()).toEqual(["alice", "bob-percent", "c-underscore"]);
  });
});
