// Drop all export_batches for the local tenant so re-ingest exercises the
// full ingest pipeline (including new synthesised-positions pass).
// people.source_batch_id has a FK to export_batches.id — null it out first.
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

await db
  .update(schema.people)
  .set({ sourceBatchId: null })
  .where(eq(schema.people.tenantId, "local"));

const deleted = await db
  .delete(schema.exportBatches)
  .where(eq(schema.exportBatches.tenantId, "local"))
  .returning({ id: schema.exportBatches.id });

console.log(`wiped ${deleted.length} batch(es) for tenant=local`);
const remaining = await db
  .select({ n: sql<number>`count(*)` })
  .from(schema.exportBatches)
  .where(eq(schema.exportBatches.tenantId, "local"));
console.log(`remaining batches: ${remaining[0]?.n ?? 0}`);
