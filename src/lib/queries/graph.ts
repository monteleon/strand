// W6 — assemble the rendered network graph. Returns a compact node/edge set
// suitable for Cytoscape's force-directed layout: owner + every person with
// ≥1 manual edge incident OR ≥1 derived edge incident with confidence ≥
// HIGH_CONFIDENCE_FLOOR, capped at NODE_CAP. Edges follow the same threshold,
// keeping the page readable at ~150 nodes / ~200 edges. Lower-confidence
// derived edges (the 15k same-employer-now-no-dates pairs) are NOT included
// in the default render — would visually noise the graph; future filter UI
// toggle can expose them.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";

const HIGH_CONFIDENCE_FLOOR = 0.7;
// The intentional choice for v1: node-entry threshold and edge-rendering
// threshold are the same. On Matt's real export this produces an owner-
// centric star (~149 owner↔connection edges), because every connection-
// to-connection edge in the data is bothCurrent at confidence 0.5 —
// densifying with those would emit ~9k edges (hairball: 3MB HTML, layout
// >11s). Future toggle: "show within-cluster mid-confidence" with an
// explicit edge cap (e.g., top-300 by confidence) and a "this may be slow"
// warning. See W6 Decisions for the full reasoning.
const EDGE_FLOOR = HIGH_CONFIDENCE_FLOOR;
const NODE_CAP = 150;

export type GraphNode = {
  id: string;
  displayName: string;
  company: string | null;
  isOwner: boolean;
  degree: number;
};

export type GraphEdgeKind =
  | "manual"
  | "derived_overlap"
  | "derived_currently"
  | "derived_no_overlap";

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  confidence: number;
  companyName: string | null;
  overlapMonths: number | null;
  note: string | null;
};

export type GraphMeta = {
  nodeCap: number;
  highConfidenceFloor: number;
  edgeFloor: number;
  candidateCount: number;
  selectedCount: number;
  totalEdges: number;
};

export type AssembledGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
};

export async function assembleNetworkGraph(
  tenantId: string = LOCAL_TENANT_ID,
): Promise<AssembledGraph> {
  // Owner row.
  const [tenantRow] = await db.all<{ owner_person_id: string | null }>(sql`
    SELECT owner_person_id FROM tenants WHERE id = ${tenantId} LIMIT 1
  `);
  const ownerId = tenantRow?.owner_person_id ?? null;

  // Candidate people: incident manual OR incident high-conf derived.
  // We keep their best incident confidence so we can cap below.
  const candidates = await db.all<{
    person_id: string;
    best_confidence: number;
    edge_count: number;
  }>(sql`
    SELECT person_id, MAX(confidence) AS best_confidence, COUNT(*) AS edge_count
    FROM (
      SELECT me.person_a AS person_id, 1.0 AS confidence FROM manual_edges me WHERE me.tenant_id = ${tenantId}
      UNION ALL
      SELECT me.person_b AS person_id, 1.0 AS confidence FROM manual_edges me WHERE me.tenant_id = ${tenantId}
      UNION ALL
      SELECT e.person_a AS person_id, e.confidence FROM derived_edges e
        WHERE e.tenant_id = ${tenantId} AND e.confidence >= ${HIGH_CONFIDENCE_FLOOR}
      UNION ALL
      SELECT e.person_b AS person_id, e.confidence FROM derived_edges e
        WHERE e.tenant_id = ${tenantId} AND e.confidence >= ${HIGH_CONFIDENCE_FLOOR}
    )
    GROUP BY person_id
    ORDER BY best_confidence DESC, edge_count DESC
  `);

  // Owner is always in (even if no incident edges).
  const selectedIds = new Set<string>();
  if (ownerId) selectedIds.add(ownerId);
  for (const c of candidates) {
    if (selectedIds.size >= NODE_CAP) break;
    selectedIds.add(c.person_id);
  }

  if (selectedIds.size === 0) {
    return {
      nodes: [],
      edges: [],
      meta: {
        nodeCap: NODE_CAP,
        highConfidenceFloor: HIGH_CONFIDENCE_FLOOR,
        edgeFloor: EDGE_FLOOR,
        candidateCount: 0,
        selectedCount: 0,
        totalEdges: 0,
      },
    };
  }

  // Fetch node metadata + each person's "current employer" for cluster colour.
  const idsList = Array.from(selectedIds);
  const rawNodes = await db.all<{
    id: string;
    full_name: string;
    company_name: string | null;
  }>(sql`
    SELECT p.id, p.full_name,
      (
        SELECT c.name
        FROM positions po
        JOIN companies c ON c.id = po.company_id AND c.tenant_id = po.tenant_id
        WHERE po.person_id = p.id AND po.tenant_id = p.tenant_id
        ORDER BY
          CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
          po.current DESC,
          COALESCE(po.start_date, '0000-00-00') DESC
        LIMIT 1
      ) AS company_name
    FROM people p
    WHERE p.tenant_id = ${tenantId}
      AND p.id IN (${sql.join(idsList.map((id) => sql`${id}`), sql`, `)})
  `);

  // Edge fetch (manual + high-conf derived) restricted to selected nodes.
  const manualEdgesRows = await db
    .select({
      personA: schema.manualEdges.personA,
      personB: schema.manualEdges.personB,
      note: schema.manualEdges.note,
    })
    .from(schema.manualEdges)
    .where(
      and(
        eq(schema.manualEdges.tenantId, tenantId),
        inArray(schema.manualEdges.personA, idsList),
        inArray(schema.manualEdges.personB, idsList),
      ),
    );
  // Edge floor (0.5) is lower than node-entry floor (0.7) deliberately:
  // a person enters the graph only if they have a high-confidence incident
  // edge, but once they're in, all derived edges ≥ 0.5 BETWEEN retained
  // nodes are drawn. This adds the same-employer-currently within-cluster
  // edges that visually anchor company clusters without exploding the node
  // count to the full network.
  const derivedEdgesRows = await db.all<{
    person_a: string;
    person_b: string;
    kind: string;
    confidence: number;
    company_name: string | null;
    overlap_months: number | null;
  }>(sql`
    SELECT person_a, person_b, kind, confidence,
      json_extract(evidence_json, '$.companyName') AS company_name,
      CAST(json_extract(evidence_json, '$.overlapMonths') AS INTEGER) AS overlap_months
    FROM derived_edges
    WHERE tenant_id = ${tenantId}
      AND confidence >= ${EDGE_FLOOR}
      AND person_a IN (${sql.join(idsList.map((id) => sql`${id}`), sql`, `)})
      AND person_b IN (${sql.join(idsList.map((id) => sql`${id}`), sql`, `)})
  `);

  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  for (const m of manualEdgesRows) {
    edges.push({
      id: `m:${m.personA}:${m.personB}`,
      source: m.personA,
      target: m.personB,
      kind: "manual",
      confidence: 1.0,
      companyName: null,
      overlapMonths: null,
      note: m.note,
    });
    bump(m.personA);
    bump(m.personB);
  }
  for (const d of derivedEdgesRows) {
    const k: GraphEdgeKind =
      d.kind === "shared_employer_overlap"
        ? "derived_overlap"
        : d.kind === "shared_employer_currently"
          ? "derived_currently"
          : "derived_no_overlap";
    edges.push({
      id: `d:${d.person_a}:${d.person_b}:${d.kind}`,
      source: d.person_a,
      target: d.person_b,
      kind: k,
      confidence: d.confidence,
      companyName: d.company_name,
      overlapMonths: d.overlap_months ?? null,
      note: null,
    });
    bump(d.person_a);
    bump(d.person_b);
  }

  const nodes: GraphNode[] = rawNodes.map((r) => ({
    id: r.id,
    displayName: r.full_name,
    company: r.company_name,
    isOwner: ownerId === r.id,
    degree: degree.get(r.id) ?? 0,
  }));

  return {
    nodes,
    edges,
    meta: {
      nodeCap: NODE_CAP,
      highConfidenceFloor: HIGH_CONFIDENCE_FLOOR,
      edgeFloor: EDGE_FLOOR,
      candidateCount: candidates.length,
      selectedCount: selectedIds.size,
      totalEdges: edges.length,
    },
  };
}
