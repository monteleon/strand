import { and, eq, or, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";

// Canonicalise the (a, b) pair so the edge is undirected and stored once.
export function canonicalisePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export type ManualEdgeIncident = {
  otherPersonId: string;
  otherPersonName: string;
  note: string | null;
  assertedAt: Date;
};

export async function createManualEdge(args: {
  personA: string;
  personB: string;
  note?: string;
  tenantId?: string;
}): Promise<
  | { kind: "created"; personA: string; personB: string }
  | { kind: "existing"; personA: string; personB: string }
> {
  const tenantId = args.tenantId ?? LOCAL_TENANT_ID;
  const [personA, personB] = canonicalisePair(args.personA, args.personB);

  const existing = await db
    .select()
    .from(schema.manualEdges)
    .where(
      and(
        eq(schema.manualEdges.tenantId, tenantId),
        eq(schema.manualEdges.personA, personA),
        eq(schema.manualEdges.personB, personB),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { kind: "existing", personA, personB };
  }
  await db.insert(schema.manualEdges).values({
    tenantId,
    personA,
    personB,
    note: args.note ?? null,
    assertedAt: new Date(),
  });
  return { kind: "created", personA, personB };
}

export async function deleteManualEdge(args: {
  personA: string;
  personB: string;
  tenantId?: string;
}): Promise<{ deleted: boolean }> {
  const tenantId = args.tenantId ?? LOCAL_TENANT_ID;
  const [personA, personB] = canonicalisePair(args.personA, args.personB);
  // 404 semantics: confirm the edge exists before deleting, so a second
  // DELETE on the same pair returns deleted:false (→ HTTP 404 at the route).
  const existing = await db
    .select()
    .from(schema.manualEdges)
    .where(
      and(
        eq(schema.manualEdges.tenantId, tenantId),
        eq(schema.manualEdges.personA, personA),
        eq(schema.manualEdges.personB, personB),
      ),
    )
    .limit(1);
  if (existing.length === 0) return { deleted: false };
  await db
    .delete(schema.manualEdges)
    .where(
      and(
        eq(schema.manualEdges.tenantId, tenantId),
        eq(schema.manualEdges.personA, personA),
        eq(schema.manualEdges.personB, personB),
      ),
    );
  return { deleted: true };
}

export async function listManualEdgesForPerson(
  personId: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<ManualEdgeIncident[]> {
  const rows = await db.all<{
    other_id: string;
    other_name: string;
    note: string | null;
    asserted_at: number;
  }>(sql`
    SELECT
      CASE WHEN me.person_a = ${personId} THEN me.person_b ELSE me.person_a END AS other_id,
      p.full_name AS other_name,
      me.note,
      me.asserted_at
    FROM manual_edges me
    JOIN people p ON p.id = (CASE WHEN me.person_a = ${personId} THEN me.person_b ELSE me.person_a END)
    WHERE me.tenant_id = ${tenantId}
      AND (me.person_a = ${personId} OR me.person_b = ${personId})
    ORDER BY me.asserted_at DESC
  `);
  return rows.map((r) => ({
    otherPersonId: r.other_id,
    otherPersonName: r.other_name,
    note: r.note,
    assertedAt: new Date(r.asserted_at * 1000),
  }));
}

export async function personExists(
  personId: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(
      and(
        eq(schema.people.tenantId, tenantId),
        eq(schema.people.id, personId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
