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
import { ALL_GRAPH_KINDS, type GraphEdgeKind } from "./graph-kinds";

export { ALL_GRAPH_KINDS, type GraphEdgeKind };

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
// EDGE_CAP exists for the same reason NODE_CAP does: at minConfidence=0.5 on
// the real dataset, derived_edges joins produce ~9k edges between the 150
// retained nodes — 3.66 MB SSR payload, Cytoscape layout >11s. Capping at
// 500-by-confidence keeps the payload bounded while still letting the user
// see "the densest 500 inferred relationships." Surfaced in GraphMeta as
// edgesTotal vs edgesShown so the UI can disclose the cap when it kicks in.
const EDGE_CAP = 500;

export type GraphNode = {
  id: string;
  displayName: string;
  company: string | null;
  isOwner: boolean;
  degree: number;
};

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
  edgeCap: number;
  highConfidenceFloor: number;
  edgeFloor: number;
  candidateCount: number;
  selectedCount: number;
  totalEdges: number;
  // `edgesTotal` is the count BEFORE the cap; `edges.length` is what shipped.
  // When edgesTotal > edges.length, the UI surfaces "M of N" so the user
  // knows lower-confidence edges were dropped to keep the page responsive.
  edgesTotal?: number;
};

export type AssembledGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
};

// v0.2.0-B (Slice B) — interactive /graph filters.
// User-controlled filters narrow the node + edge set without changing NODE_CAP
// (the densifying-to-9k-edges hairball from the W6 Changelog stays prevented).
export type GraphFilters = {
  kinds?: GraphEdgeKind[];   // default: all four kinds
  minConfidence?: number;    // default: HIGH_CONFIDENCE_FLOOR (0.7)
  // Post-filter: drop any non-owner node with visible-edge degree below this
  // threshold (and the edges incident to it). Defaults to 1 (= no filter).
  // Owner is always retained even if their degree would otherwise be 0 —
  // dropping the user's own node would render the graph meaningless.
  minDegree?: number;
};

// UI kind → DB kind for the `derived_edges.kind` enum.
const DERIVED_DB_KIND: Record<
  Exclude<GraphEdgeKind, "manual">,
  "shared_employer_overlap" | "shared_employer_currently" | "shared_employer_no_overlap"
> = {
  derived_overlap: "shared_employer_overlap",
  derived_currently: "shared_employer_currently",
  derived_no_overlap: "shared_employer_no_overlap",
};

function emptyAssembled(minConfidence: number, candidateCount = 0): AssembledGraph {
  return {
    nodes: [],
    edges: [],
    meta: {
      nodeCap: NODE_CAP,
      edgeCap: EDGE_CAP,
      highConfidenceFloor: minConfidence,
      edgeFloor: minConfidence,
      candidateCount,
      selectedCount: 0,
      totalEdges: 0,
    },
  };
}

export async function assembleNetworkGraph(
  tenantId: string = LOCAL_TENANT_ID,
  filters: GraphFilters = {},
): Promise<AssembledGraph> {
  // Resolve filter defaults. Empty `kinds` array is treated as "all selected"
  // so callers can default-construct GraphFilters without ceremony; the UI
  // never sends an empty array (ISC-209 forbids deselecting all kinds).
  const kinds: GraphEdgeKind[] =
    filters.kinds && filters.kinds.length > 0 ? filters.kinds : ALL_GRAPH_KINDS;
  const minConfidence = filters.minConfidence ?? HIGH_CONFIDENCE_FLOOR;
  const includeManual = kinds.includes("manual");
  const derivedKinds = kinds.filter((k): k is Exclude<GraphEdgeKind, "manual"> => k !== "manual");
  const derivedDbKinds = derivedKinds.map((k) => DERIVED_DB_KIND[k]);

  // Owner row.
  const [tenantRow] = await db.all<{ owner_person_id: string | null }>(sql`
    SELECT owner_person_id FROM tenants WHERE id = ${tenantId} LIMIT 1
  `);
  const ownerId = tenantRow?.owner_person_id ?? null;

  // Candidate people: incident manual OR incident derived edges that pass the
  // confidence + kind filters. We keep their best incident confidence so we
  // can cap below at NODE_CAP. Each leg of the UNION is conditional — if a
  // filter excludes manual or all derived kinds, that leg is dropped entirely
  // rather than emitted as a no-op WHERE-clause-against-empty-IN.
  const candidateLegs: ReturnType<typeof sql>[] = [];
  if (includeManual) {
    candidateLegs.push(sql`
      SELECT me.person_a AS person_id, 1.0 AS confidence
      FROM manual_edges me WHERE me.tenant_id = ${tenantId}
    `);
    candidateLegs.push(sql`
      SELECT me.person_b AS person_id, 1.0 AS confidence
      FROM manual_edges me WHERE me.tenant_id = ${tenantId}
    `);
  }
  if (derivedDbKinds.length > 0) {
    const derivedKindList = sql.join(
      derivedDbKinds.map((k) => sql`${k}`),
      sql`, `,
    );
    candidateLegs.push(sql`
      SELECT e.person_a AS person_id, e.confidence FROM derived_edges e
      WHERE e.tenant_id = ${tenantId}
        AND e.confidence >= ${minConfidence}
        AND e.kind IN (${derivedKindList})
    `);
    candidateLegs.push(sql`
      SELECT e.person_b AS person_id, e.confidence FROM derived_edges e
      WHERE e.tenant_id = ${tenantId}
        AND e.confidence >= ${minConfidence}
        AND e.kind IN (${derivedKindList})
    `);
  }
  if (candidateLegs.length === 0) {
    // No kinds selected at all — return empty rather than synthesise rows.
    return emptyAssembled(minConfidence);
  }
  const candidates = await db.all<{
    person_id: string;
    best_confidence: number;
    edge_count: number;
  }>(sql`
    SELECT person_id, MAX(confidence) AS best_confidence, COUNT(*) AS edge_count
    FROM (${sql.join(candidateLegs, sql` UNION ALL `)})
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
    return emptyAssembled(minConfidence, candidates.length);
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

  // Edge fetch — both manual and derived obey the active filters (kinds +
  // minConfidence) AND are restricted to the already-selected node set.
  // When a filter excludes a class entirely, skip the SQL round-trip.
  const manualEdgesRows = includeManual
    ? await db
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
        )
    : [];
  // Edge-confidence floor is the user-selected minConfidence (was a fixed
  // 0.7 pre-Slice-B). NODE_CAP still bounds the rendered set so lowering
  // the slider to 0.0 does not crash — it just surfaces more low-confidence
  // edges among the already-capped nodes.
  const derivedEdgesRows =
    derivedDbKinds.length === 0
      ? []
      : await db.all<{
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
      AND confidence >= ${minConfidence}
      AND kind IN (${sql.join(derivedDbKinds.map((k) => sql`${k}`), sql`, `)})
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

  // Cap derived edges at EDGE_CAP by confidence (descending). Manual edges
  // are confidence 1.0 (above any derived edge) so they always survive the
  // sort, and stable-sort behaviour keeps the original order within ties.
  // The cap fires BEFORE the min-degree filter so degree is computed against
  // what the user will actually see.
  const edgesTotal = edges.length;
  let cappedEdges = edges;
  if (edges.length > EDGE_CAP) {
    cappedEdges = [...edges]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, EDGE_CAP);
    // Rebuild degree against the surviving edges so nodes and the
    // (about-to-run) min-degree filter agree on degree.
    degree.clear();
    for (const e of cappedEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
  }

  let nodes: GraphNode[] = rawNodes.map((r) => ({
    id: r.id,
    displayName: r.full_name,
    company: r.company_name,
    isOwner: ownerId === r.id,
    degree: degree.get(r.id) ?? 0,
  }));
  let finalEdges = cappedEdges;

  // Min-degree post-filter (NEW v0.2.0-C). Default 1 = pass-through (every
  // node with ≥1 edge is already in the candidate set). >1 drops sparse
  // nodes + cascades the drop to their incident edges, in a single pass:
  // the owner is exempt (always kept) so the user's anchor never disappears.
  const minDegree = filters.minDegree ?? 1;
  if (minDegree > 1) {
    const keepIds = new Set<string>();
    for (const n of nodes) {
      if (n.isOwner || (degree.get(n.id) ?? 0) >= minDegree) keepIds.add(n.id);
    }
    // Filter against the already-capped edge set, not the raw `edges` array —
    // otherwise the min-degree cascade would re-introduce edges the EDGE_CAP
    // had already excluded.
    finalEdges = cappedEdges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
    // Recompute degree against the surviving edges so the rendered count
    // matches what the user sees.
    const newDegree = new Map<string, number>();
    for (const e of finalEdges) {
      newDegree.set(e.source, (newDegree.get(e.source) ?? 0) + 1);
      newDegree.set(e.target, (newDegree.get(e.target) ?? 0) + 1);
    }
    nodes = nodes
      .filter((n) => keepIds.has(n.id))
      .map((n) => ({ ...n, degree: newDegree.get(n.id) ?? 0 }));
  }

  return {
    nodes,
    edges: finalEdges,
    meta: {
      nodeCap: NODE_CAP,
      edgeCap: EDGE_CAP,
      // Reflect the active filter so the UI's "confidence floor" stat
      // matches the slider position rather than the project-default constant.
      highConfidenceFloor: minConfidence,
      edgeFloor: minConfidence,
      candidateCount: candidates.length,
      selectedCount: nodes.length,
      totalEdges: finalEdges.length,
      // `edgesTotal` is the pre-cap count from the SQL fetch + manual edges
      // pre-min-degree. Only surfaces when actually larger than the rendered
      // set so the UI can show "M of N" only when the cap kicks in.
      edgesTotal: edgesTotal > finalEdges.length ? edgesTotal : undefined,
    },
  };
}
