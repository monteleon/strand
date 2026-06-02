// Read-side queries for derived edges. Kept in a separate module from
// manualEdges (ISC-94 anti-criterion): the two epistemic categories never
// share a query, a result type, or a UI list. Different epistemics →
// different code paths.
import { LOCAL_TENANT_ID, db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type DerivedEdgeKind =
  | "shared_employer_overlap"
  | "shared_employer_currently"
  | "shared_employer_no_overlap";

export type DerivedEdgeIncident = {
  otherPersonId: string;
  otherPersonName: string;
  kind: DerivedEdgeKind;
  confidence: number;
  companyId: string | null;
  companyName: string | null;
  overlapMonths: number;
  bothCurrent: boolean;
};

export type DerivedPairAtCompany = {
  personAId: string;
  personAName: string;
  personBId: string;
  personBName: string;
  kind: DerivedEdgeKind;
  confidence: number;
  overlapMonths: number;
  bothCurrent: boolean;
};

// All derived edges incident to one person. Ordered by confidence desc, then
// overlap-months desc. The companyName comes from the evidence JSON — we keep
// the evidence column as the system of record for the why-behind-the-edge.
// Returns one row per (other-person, kind): a colleague sharing multiple
// employers under the same kind (post-0005 company_id in PK can land N rows)
// collapses to the strongest signal — highest confidence, then longest
// overlap. Restores the pre-0005 one-row-per-pair UX without losing the
// other companies in storage.
export async function listDerivedEdgesForPerson(
  personId: string,
  tenantId: string = LOCAL_TENANT_ID,
  limit: number = 50,
): Promise<DerivedEdgeIncident[]> {
  const rows = await db.all<{
    other_id: string;
    other_name: string;
    kind: DerivedEdgeKind;
    confidence: number;
    company_id: string | null;
    company_name: string | null;
    overlap_months: number;
    both_current: number;
  }>(sql`
    SELECT other_id, other_name, kind, confidence, company_id, company_name,
           overlap_months, both_current
    FROM (
      SELECT
        CASE WHEN e.person_a = ${personId} THEN e.person_b ELSE e.person_a END AS other_id,
        p.full_name AS other_name,
        e.kind,
        e.confidence,
        e.company_id AS company_id,
        json_extract(e.evidence_json, '$.companyName') AS company_name,
        CAST(json_extract(e.evidence_json, '$.overlapMonths') AS INTEGER) AS overlap_months,
        json_extract(e.evidence_json, '$.bothCurrent') AS both_current,
        ROW_NUMBER() OVER (
          PARTITION BY
            CASE WHEN e.person_a = ${personId} THEN e.person_b ELSE e.person_a END,
            e.kind
          ORDER BY
            e.confidence DESC,
            CAST(json_extract(e.evidence_json, '$.overlapMonths') AS INTEGER) DESC
        ) AS rn
      FROM derived_edges e
      JOIN people p ON p.id = (CASE WHEN e.person_a = ${personId} THEN e.person_b ELSE e.person_a END)
      WHERE e.tenant_id = ${tenantId}
        AND (e.person_a = ${personId} OR e.person_b = ${personId})
    )
    WHERE rn = 1
    ORDER BY confidence DESC, overlap_months DESC, other_name ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    otherPersonId: r.other_id,
    otherPersonName: r.other_name,
    kind: r.kind,
    confidence: r.confidence,
    companyId: r.company_id,
    companyName: r.company_name,
    overlapMonths: r.overlap_months ?? 0,
    bothCurrent: r.both_current === 1,
  }));
}

// Strongest derived pairs at one company — used by /companies/[id].
export async function listDerivedPairsAtCompany(
  companyId: string,
  tenantId: string = LOCAL_TENANT_ID,
  limit: number = 20,
): Promise<DerivedPairAtCompany[]> {
  const rows = await db.all<{
    person_a: string;
    person_a_name: string;
    person_b: string;
    person_b_name: string;
    kind: DerivedEdgeKind;
    confidence: number;
    overlap_months: number;
    both_current: number;
  }>(sql`
    SELECT e.person_a, pa.full_name AS person_a_name,
           e.person_b, pb.full_name AS person_b_name,
           e.kind, e.confidence,
           CAST(json_extract(e.evidence_json, '$.overlapMonths') AS INTEGER) AS overlap_months,
           json_extract(e.evidence_json, '$.bothCurrent') AS both_current
    FROM derived_edges e
    JOIN people pa ON pa.id = e.person_a
    JOIN people pb ON pb.id = e.person_b
    WHERE e.tenant_id = ${tenantId}
      AND e.company_id = ${companyId}
    ORDER BY e.confidence DESC, overlap_months DESC, pa.full_name ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    personAId: r.person_a,
    personAName: r.person_a_name,
    personBId: r.person_b,
    personBName: r.person_b_name,
    kind: r.kind,
    confidence: r.confidence,
    overlapMonths: r.overlap_months ?? 0,
    bothCurrent: r.both_current === 1,
  }));
}

export function confidenceLabel(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.6) return "Medium";
  return "Low";
}
