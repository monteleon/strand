// Bookmark CRUD. A bookmark is a friendly name + the URL it should
// recall (with all query params encoded in the URL itself). The query
// surface stays stateless; bookmarks are pointers, not query specs.
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";

export type SavedQuery = {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
};

const sha1Hex = (s: string) =>
  createHash("sha1").update(s).digest("hex");

export async function listSavedQueries(
  tenantId: string = LOCAL_TENANT_ID,
): Promise<SavedQuery[]> {
  const rows = await db
    .select()
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.tenantId, tenantId))
    .orderBy(desc(schema.savedQueries.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    createdAt: r.createdAt,
  }));
}

export async function createSavedQuery(args: {
  name: string;
  url: string;
  tenantId?: string;
}): Promise<
  | { kind: "created"; query: SavedQuery }
  | { kind: "duplicate_name" }
> {
  const tenantId = args.tenantId ?? LOCAL_TENANT_ID;
  const trimmedName = args.name.trim();
  const trimmedUrl = args.url.trim();
  // Caller is expected to validate; this is a defensive guard.
  if (!trimmedName) throw new Error("name required");
  if (!trimmedUrl) throw new Error("url required");

  const existing = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.tenantId, tenantId),
        eq(schema.savedQueries.name, trimmedName),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { kind: "duplicate_name" };

  const now = new Date();
  // Deterministic-ish id keyed off name + url + tenant + ms; survives the
  // unique-name check above, so collisions on id alone would only happen
  // if a single ms produced two identical-input creates (won't happen).
  const id = sha1Hex(`${tenantId}|${trimmedName}|${trimmedUrl}|${now.getTime()}`);
  await db.insert(schema.savedQueries).values({
    id,
    tenantId,
    name: trimmedName,
    url: trimmedUrl,
    createdAt: now,
  });
  return {
    kind: "created",
    query: { id, name: trimmedName, url: trimmedUrl, createdAt: now },
  };
}

export async function deleteSavedQuery(
  id: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<{ deleted: boolean }> {
  const existing = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.tenantId, tenantId),
        eq(schema.savedQueries.id, id),
      ),
    )
    .limit(1);
  if (existing.length === 0) return { deleted: false };
  await db
    .delete(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.tenantId, tenantId),
        eq(schema.savedQueries.id, id),
      ),
    );
  return { deleted: true };
}
