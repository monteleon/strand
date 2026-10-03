import { createClient, type ResultSet } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import * as schema from "./schema";

const DEFAULT_DB_PATH = "data/strand.db";

function resolveDbPath(): string {
  const raw = process.env.STRAND_DB_PATH ?? DEFAULT_DB_PATH;
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

const dbPath = resolveDbPath();
mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });

// WAL journal mode. Ingest and derive each run as ONE write transaction; in
// SQLite's default rollback-journal mode a large write transaction locks
// readers out (SQLITE_BUSY on every page load mid-ingest). Under WAL, readers
// keep reading the last committed snapshot while the writer works. The mode
// is persistent in the DB file, so this converts existing databases on first
// start. The libsql file client executes synchronously up to its first await,
// so the pragma has run before any query below can be issued.
// Skipped during `next build`: its parallel page-data workers all import this
// module and would race each other converting the same file ("database is
// locked"). The build never needs the DB; `next start` and migrate set it.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  client.execute("PRAGMA journal_mode = WAL").catch((err) => {
    console.error("[db] could not enable WAL journal mode:", err);
  });
}

export const db = drizzle(client, { schema });
export { schema };
export const LOCAL_TENANT_ID = "local";

// Either the shared `db` or a transaction handle from `db.transaction(tx =>
// …)`. Write paths that must be all-or-nothing (ingest, derive) take one of
// these so a caller can run them inside its own transaction.
export type DbExecutor = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;
