import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
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

export const db = drizzle(client, { schema });
export { schema };
export const LOCAL_TENANT_ID = "local";
