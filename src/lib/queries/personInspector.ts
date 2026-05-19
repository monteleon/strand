import { and, eq, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { getOwnerId } from "@/lib/queries/people";

export type InspectorPosition = {
  title: string | null;
  companyName: string | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  origin: "declared" | "synthesised";
};

export type InspectorPayload = {
  id: string;
  fullName: string;
  headline: string | null;
  linkedinUrl: string | null;
  isOwner: boolean;
  current: InspectorPosition | null;
  edgeCounts: {
    manual: number;
    derivedOverlap: number;
    derivedCurrently: number;
    derivedNoOverlap: number;
  };
  connectedAt: string | null;
};

export async function getPersonInspector(
  id: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<InspectorPayload | null> {
  const [person] = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.tenantId, tenantId), eq(schema.people.id, id)))
    .limit(1);
  if (!person) return null;

  const ownerId = await getOwnerId(tenantId);

  const [position] = await db.all<{
    title: string | null;
    company_name: string | null;
    start_date: string | null;
    end_date: string | null;
    current: number;
    origin: string;
  }>(sql`
    SELECT po.title, c.name AS company_name, po.start_date, po.end_date,
           po.current, po.origin
    FROM positions po
    LEFT JOIN companies c ON c.id = po.company_id AND c.tenant_id = po.tenant_id
    WHERE po.person_id = ${id} AND po.tenant_id = ${tenantId}
    ORDER BY
      CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
      po.current DESC,
      COALESCE(po.start_date, '0000-00-00') DESC
    LIMIT 1
  `);

  const [edgeCounts] = await db.all<{
    manual: number;
    derived_overlap: number;
    derived_currently: number;
    derived_no_overlap: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM manual_edges
         WHERE tenant_id = ${tenantId}
           AND (person_a = ${id} OR person_b = ${id})) AS manual,
      (SELECT COUNT(*) FROM derived_edges
         WHERE tenant_id = ${tenantId}
           AND kind = 'shared_employer_overlap'
           AND (person_a = ${id} OR person_b = ${id})) AS derived_overlap,
      (SELECT COUNT(*) FROM derived_edges
         WHERE tenant_id = ${tenantId}
           AND kind = 'shared_employer_currently'
           AND (person_a = ${id} OR person_b = ${id})) AS derived_currently,
      (SELECT COUNT(*) FROM derived_edges
         WHERE tenant_id = ${tenantId}
           AND kind = 'shared_employer_no_overlap'
           AND (person_a = ${id} OR person_b = ${id})) AS derived_no_overlap
  `);

  const [conn] = await db
    .select({ connectedAt: schema.connections.connectedAt })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.tenantId, tenantId),
        eq(schema.connections.toPersonId, id),
      ),
    )
    .limit(1);

  return {
    id: person.id,
    fullName: person.fullName,
    headline: person.headline,
    linkedinUrl: person.linkedinUrl,
    isOwner: person.id === ownerId,
    current: position
      ? {
          title: position.title,
          companyName: position.company_name,
          startDate: position.start_date,
          endDate: position.end_date,
          current: Boolean(position.current),
          origin: position.origin as "declared" | "synthesised",
        }
      : null,
    edgeCounts: {
      manual: edgeCounts?.manual ?? 0,
      derivedOverlap: edgeCounts?.derived_overlap ?? 0,
      derivedCurrently: edgeCounts?.derived_currently ?? 0,
      derivedNoOverlap: edgeCounts?.derived_no_overlap ?? 0,
    },
    connectedAt: conn?.connectedAt ?? null,
  };
}
