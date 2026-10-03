import { afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// `bun test` preload (wired in bunfig.toml). Runs once, before any test file
// is imported, so every in-process `@/lib/db` import binds to the same DB.
//
// Default: a throwaway SQLite file seeded from the synthetic export
// (test/fixtures/synthetic-export.ts) — portable, private, and the query
// suites assert exact facts against it. Nothing touches data/strand.db.
//
// Opt-out: set STRAND_DB_PATH yourself to run the suites against a DB you
// populated (e.g. your real ingest). Subprocess-based suites always use their
// own mkdtemp DBs either way.

const REPO_ROOT = resolve(import.meta.dir, "..");

if (!process.env.STRAND_DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), "strand-test-"));
  process.env.STRAND_DB_PATH = join(dir, "strand.db");
  // Global hook (registered from the preload, so it runs once after the
  // whole run). process.on("exit") does not fire under `bun test`.
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // migrate.ts is a top-level-await CLI script, so run it as one.
  const migrated = spawnSync(process.execPath, ["run", "src/lib/db/migrate.ts"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  });
  if (migrated.status !== 0) {
    throw new Error(`test preload: migrate failed\n${migrated.stderr}`);
  }

  const { ingestLinkedInExport } = await import("../src/lib/linkedin/ingest");
  const { buildSyntheticExport } = await import("./fixtures/synthetic-export");
  await ingestLinkedInExport(await buildSyntheticExport(), "synthetic-export.zip");
}
