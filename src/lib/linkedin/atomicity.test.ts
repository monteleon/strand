import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FIXTURE } from "../../../test/fixtures/synthetic-export";

// v0.4.26: ingest and derive are all-or-nothing. Each scenario runs in a
// subprocess against its own throwaway DB (same pattern as ingest.test.ts)
// and injects a failure with a SQLite trigger — RAISE(ABORT) on insert into
// a chosen table — so the failure lands at a precise point mid-write.

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const RESULT_MARKER = "__ATOMICITY_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-atomicity-test-"));
  const dbPath = join(dir, "test.db");
  const proc = Bun.spawn([process.execPath, "run", "src/lib/db/migrate.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, STRAND_DB_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`migrate failed: ${await new Response(proc.stderr).text()}`);
  }
  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runScenario<T>(body: string): Promise<T> {
  const fresh = await freshDbWithMigrations();
  try {
    const script = `
      const { db, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
      const { ingestLinkedInExport } = await import("${REPO_ROOT}/src/lib/linkedin/ingest.ts");
      const { deriveSharedEmployerEdges } = await import("${REPO_ROOT}/src/lib/derived/edges.ts");
      const { buildSyntheticExport } = await import("${REPO_ROOT}/test/fixtures/synthetic-export.ts");
      const { sql } = await import("drizzle-orm");
      const count = async (table) =>
        Number((await db.all(sql.raw("SELECT COUNT(*) AS c FROM " + table)))[0].c);
      const snapshot = async () => ({
        batches: await count("export_batches"),
        people: await count("people"),
        companies: await count("companies"),
        positions: await count("positions"),
        connections: await count("connections"),
        derivedEdges: await count("derived_edges"),
        messages: await count("messages"),
      });
      const failInsertsInto = (table) =>
        db.run(sql.raw(
          "CREATE TRIGGER inject_fail BEFORE INSERT ON " + table +
          " BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
        ));
      const clearInjection = () => db.run(sql.raw("DROP TRIGGER inject_fail"));
      const errorOf = async (fn) => {
        try { await fn(); return null; } catch (e) { return String(e?.message ?? e); }
      };
      ${body}
    `;
    const proc = Bun.spawn([process.execPath, "-e", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, STRAND_DB_PATH: fresh.dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const line = stdout.split("\n").find((l) => l.startsWith(RESULT_MARKER));
    if (code !== 0 || !line) {
      throw new Error(`scenario failed (exit ${code})\n${stderr}\n${stdout}`);
    }
    return JSON.parse(line.slice(RESULT_MARKER.length)) as T;
  } finally {
    fresh.cleanup();
  }
}

type Snapshot = {
  batches: number;
  people: number;
  companies: number;
  positions: number;
  connections: number;
  derivedEdges: number;
  messages: number;
};

describe("ingest is all-or-nothing", () => {
  let r: {
    error: string | null;
    afterFailure: Snapshot;
    retry: { duplicate: boolean; counts: { people: number; messages: number } };
    afterRetry: Snapshot;
  };

  beforeAll(async () => {
    r = await runScenario(`
      const bytes = await buildSyntheticExport();
      // messages are written LAST — after people, positions and derive — so
      // this is the worst case: everything else already written in-tx.
      await failInsertsInto("messages");
      const error = await errorOf(() => ingestLinkedInExport(bytes, "synthetic.zip"));
      const afterFailure = await snapshot();
      await clearInjection();
      const retry = await ingestLinkedInExport(bytes, "synthetic.zip");
      const afterRetry = await snapshot();
      console.log("${RESULT_MARKER}" + JSON.stringify({ error, afterFailure, retry, afterRetry }));
    `);
  }, 60_000);

  test("a failure late in ingest surfaces as an error", () => {
    expect(r.error).toContain("injected failure");
  });

  test("nothing from the failed ingest persists — batch row included", () => {
    expect(r.afterFailure).toEqual({
      batches: 0,
      people: 0,
      companies: 0,
      positions: 0,
      connections: 0,
      derivedEdges: 0,
      messages: 0,
    });
  });

  test("re-uploading the same zip is NOT treated as a duplicate", () => {
    expect(r.retry.duplicate).toBe(false);
  });

  test("the retry lands the full dataset", () => {
    expect(r.afterRetry.batches).toBe(1);
    expect(r.afterRetry.people).toBe(FIXTURE.people);
    expect(r.afterRetry.companies).toBe(FIXTURE.companies);
    expect(r.afterRetry.messages).toBe(FIXTURE.messagesInserted);
    expect(r.afterRetry.derivedEdges).toBeGreaterThan(0);
  });
});

describe("a failed re-ingest leaves the previous ingest intact", () => {
  let r: {
    error: string | null;
    before: Snapshot;
    after: Snapshot;
    ownerUrlBefore: string | null;
    ownerUrlAfter: string | null;
  };

  beforeAll(async () => {
    r = await runScenario(`
      const ownerUrl = async () =>
        (await db.all(sql\`
          SELECT p.linkedin_url AS u FROM people p
          JOIN tenants t ON t.owner_person_id = p.id WHERE t.id = 'local'
        \`))[0]?.u ?? null;
      // First: a Basic export (no messages.csv) ingests cleanly.
      await ingestLinkedInExport(
        await buildSyntheticExport({ includeMessages: false }),
        "basic.zip",
      );
      const before = await snapshot();
      const ownerUrlBefore = await ownerUrl();
      // Then: the Complete export fails at its messages step. It would have
      // added a batch row, backfilled the owner URL and rebuilt derived edges.
      await failInsertsInto("messages");
      const error = await errorOf(async () =>
        ingestLinkedInExport(await buildSyntheticExport(), "complete.zip"),
      );
      const after = await snapshot();
      const ownerUrlAfter = await ownerUrl();
      console.log("${RESULT_MARKER}" + JSON.stringify({ error, before, after, ownerUrlBefore, ownerUrlAfter }));
    `);
  }, 60_000);

  test("the second ingest failed", () => {
    expect(r.error).toContain("injected failure");
  });

  test("every table is exactly as the first ingest left it", () => {
    expect(r.before.batches).toBe(1);
    expect(r.before.derivedEdges).toBeGreaterThan(0);
    expect(r.after).toEqual(r.before);
  });

  test("the owner-URL backfill from the failed ingest was rolled back", () => {
    expect(r.ownerUrlBefore).toBeNull();
    expect(r.ownerUrlAfter).toBeNull();
  });
});

describe("derive is atomic", () => {
  let failed: { edgesBefore: number; error: string | null; edgesAfter: number };
  let concurrent: { edgesBefore: number; reads: number[]; edgesAfter: number };

  beforeAll(async () => {
    [failed, concurrent] = await Promise.all([
      runScenario<typeof failed>(`
        await ingestLinkedInExport(await buildSyntheticExport(), "synthetic.zip");
        const edgesBefore = await count("derived_edges");
        // The DELETE runs first, then chunked INSERTs — fail the INSERTs.
        await failInsertsInto("derived_edges");
        const error = await errorOf(() => deriveSharedEmployerEdges());
        const edgesAfter = await count("derived_edges");
        console.log("${RESULT_MARKER}" + JSON.stringify({ edgesBefore, error, edgesAfter }));
      `),
      runScenario<typeof concurrent>(`
        await ingestLinkedInExport(await buildSyntheticExport(), "synthetic.zip");
        const edgesBefore = await count("derived_edges");
        // Read the edge count over and over while a derive pass runs. Both
        // sides only yield at awaits, so the reads interleave with derive's
        // DELETE and every INSERT chunk.
        let done = false;
        const pass = deriveSharedEmployerEdges().finally(() => { done = true; });
        const reads = [];
        while (!done) reads.push(await count("derived_edges"));
        await pass;
        const edgesAfter = await count("derived_edges");
        console.log("${RESULT_MARKER}" + JSON.stringify({ edgesBefore, reads, edgesAfter }));
      `),
    ]);
  }, 60_000);

  test("a derive that fails mid-insert keeps the previous edge set", () => {
    expect(failed.edgesBefore).toBeGreaterThan(0);
    expect(failed.error).toContain("injected failure");
    expect(failed.edgesAfter).toBe(failed.edgesBefore);
  });

  test("concurrent readers never see derived_edges empty or partially rebuilt", () => {
    expect(concurrent.edgesBefore).toBeGreaterThan(0);
    // The reads must actually have overlapped the pass, or this proves nothing.
    expect(concurrent.reads.length).toBeGreaterThan(3);
    for (const n of concurrent.reads) expect(n).toBe(concurrent.edgesBefore);
    expect(concurrent.edgesAfter).toBe(concurrent.edgesBefore);
  });
});
