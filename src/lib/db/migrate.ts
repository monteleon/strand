import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const DEFAULT_DB_PATH = "data/strand.db";
const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

const raw = process.env.STRAND_DB_PATH ?? DEFAULT_DB_PATH;
const dbPath = isAbsolute(raw) ? raw : join(process.cwd(), raw);
mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });
const db = drizzle(client);

await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

await client.execute({
  sql: "INSERT OR IGNORE INTO tenants (id, created_at) VALUES (?, ?)",
  args: ["local", Math.floor(Date.now() / 1000)],
});

console.log(`strand: migrated ${dbPath}; tenant 'local' present.`);
