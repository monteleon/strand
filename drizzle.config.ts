import type { Config } from "drizzle-kit";

const dbPath = process.env.STRAND_DB_PATH ?? "data/strand.db";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${dbPath}`,
  },
} satisfies Config;
