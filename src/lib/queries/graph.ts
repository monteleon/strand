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
  // v0.4.0 (ISC-374): active filters surfaced for the UI. Only populated
  // when overridden from defaults; absent fields = default.
  cap?: number;             // present when overridden from NODE_CAP default
  companyId?: string;       // present when company filter is active
  companyName?: string;     // resolved name for display (null if id unknown)
  scope?: GraphScope;       // present when companyId is set
};

export type AssembledGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
};

// v0.2.0-B (Slice B) — interactive /graph filters.
// User-controlled filters narrow the node + edge set without changing NODE_CAP
// (the densifying-to-9k-edges hairball from the W6 Changelog stays prevented).
export type GraphScope = "current" | "ever";

export type GraphFilters = {
  kinds?: GraphEdgeKind[];   // default: all four kinds
  minConfidence?: number;    // default: HIGH_CONFIDENCE_FLOOR (0.7)
  // Post-filter: drop any non-owner node with visible-edge degree below this
  // threshold (and the edges incident to it). Defaults to 1 (= no filter).
  // Owner is always retained even if their degree would otherwise be 0 —
  // dropping the user's own node would render the graph meaningless.
  minDegree?: number;
  // v0.4.0 (ISC-367..375): node cap + company-scope restriction.
  // cap: clamps the rendered node count to [1, MAX_NODE_CAP]; default NODE_CAP.
  // companyId: restricts the candidate set to people at this company. When
  //   unset (or unknown id), no restriction applies.
  // scope: when companyId is set, picks "current" (current employer only,
  //   per the v0.3.4 ROW_NUMBER selection rule) vs "ever" (any past position
  //   at the company). Ignored when companyId is unset. Default "current".
  cap?: number;
  companyId?: string;
  scope?: GraphScope;
};

// v0.4.0: hard upper bound on cap (parallel to EDGE_CAP = 500). Cose layout
// degrades beyond ~500 nodes and the SSR payload climbs; clamp here so a
// URL like `?cap=99999` doesn't accidentally DoS the renderer.
export const MAX_NODE_CAP = 500;
// v0.4.0: dropdown snap points exposed via this list — the UI consumes it,
// the server doesn't enforce these specific values (any int in [1, MAX] is
// accepted; the dropdown is just a UX affordance).
export const CAP_DROPDOWN_VALUES = [50, 100, 150, 250, 500] as const;

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

  // v0.4.0 (ISC-368, Advisor patch): cap is a DISCRETE control — it must be
  // one of CAP_DROPDOWN_VALUES. Anything else (including out-of-range ints,
  // non-snap ints like 37, and non-numeric input) falls back to NODE_CAP
  // (default). This makes URL ⇔ dropdown an exact round-trip; no silent
  // snap-on-render, no UI/server drift. Stance (1) from the Advisor review.
  const rawCap = filters.cap;
  const cap =
    typeof rawCap === "number" &&
    Number.isFinite(rawCap) &&
    (CAP_DROPDOWN_VALUES as readonly number[]).includes(rawCap)
      ? rawCap
      : NODE_CAP;
  // v0.4.0 (ISC-369): companyId is opaque; we only know it's invalid if a
  // later DB lookup confirms it doesn't exist. For the candidates filter, we
  // pass the string through — if no people match, the resulting empty set
  // produces an empty assembled graph (ISC-375), which is the right
  // "company not found" behaviour.
  const companyId = filters.companyId?.trim() || null;
  const scope: GraphScope = filters.scope === "ever" ? "ever" : "current";

  // Owner row.
  const [tenantRow] = await db.all<{ owner_person_id: string | null }>(sql`
    SELECT owner_person_id FROM tenants WHERE id = ${tenantId} LIMIT 1
  `);
  const ownerId = tenantRow?.owner_person_id ?? null;

  // v0.4.0 (ISC-370, ISC-371): when companyId is set, precompute the allowed
  // person-id set. "current" mode uses the v0.3.4 ROW_NUMBER selection rule
  // to pick each person's current employer; "ever" mode includes any person
  // with any position at the company. Both are tenant-scoped — ISC-400
  // Advisor focus.
  let allowedPersonIds: Set<string> | null = null;
  let companyName: string | null = null;
  if (companyId) {
    const [companyRow] = await db.all<{ name: string }>(sql`
      SELECT name FROM companies WHERE tenant_id = ${tenantId} AND id = ${companyId} LIMIT 1
    `);
    companyName = companyRow?.name ?? null;
    if (scope === "ever") {
      const rows = await db.all<{ person_id: string }>(sql`
        SELECT DISTINCT person_id FROM positions
        WHERE tenant_id = ${tenantId} AND company_id = ${companyId}
      `);
      allowedPersonIds = new Set(rows.map((r) => r.person_id));
    } else {
      // scope = "current" — same selection chain as v0.3.4 employer lookup
      const rows = await db.all<{ person_id: string }>(sql`
        WITH ranked AS (
          SELECT
            po.person_id,
            po.company_id,
            ROW_NUMBER() OVER (
              PARTITION BY po.person_id
              ORDER BY
                CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
                po.current DESC,
                COALESCE(po.start_date, '0000-00-00') DESC,
                po.id ASC
            ) AS rn
          FROM positions po
          WHERE po.tenant_id = ${tenantId}
        )
        SELECT person_id FROM ranked
        WHERE rn = 1 AND company_id = ${companyId}
      `);
      allowedPersonIds = new Set(rows.map((r) => r.person_id));
    }
    // If the company has zero matching people, short-circuit to empty —
    // owner is still added below per ISC-373 (rendered disconnected).
  }

  // Candidate people: incident manual OR incident derived edges that pass the
  // confidence + kind filters. We keep their best incident confidence so we
  // can cap below at NODE_CAP.
  //
  // v0.3.4 (ISC-353/356): the original UNION ALL 4× pattern scanned each
  // table TWICE (once per endpoint). On real data (15709 derived_edges
  // rows) that was ~1100ms — the dominant cost of /graph TTFB. Collapsed
  // to UNION ALL 2× using a CROSS JOIN unpivot — each table is scanned
  // ONCE and emits 2 rows per edge via the synthetic `n` selector. Same
  // logical result, half the table scans.
  const candidateLegs: ReturnType<typeof sql>[] = [];
  if (includeManual) {
    candidateLegs.push(sql`
      SELECT
        CASE n WHEN 0 THEN me.person_a ELSE me.person_b END AS person_id,
        1.0 AS confidence
      FROM manual_edges me
      CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1 AS n) endpoints
      WHERE me.tenant_id = ${tenantId}
    `);
  }
  if (derivedDbKinds.length > 0) {
    const derivedKindList = sql.join(
      derivedDbKinds.map((k) => sql`${k}`),
      sql`, `,
    );
    candidateLegs.push(sql`
      SELECT
        CASE n WHEN 0 THEN e.person_a ELSE e.person_b END AS person_id,
        e.confidence
      FROM derived_edges e
      CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1 AS n) endpoints
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

  // v0.4.0 (ISC-372): filter THEN cap. Apply the company-scope filter first
  // (narrows the candidate list), then take the top `cap` entries. "100 at
  // PwC España" yields ≤100 at PwC, not "100 candidates of which some are at
  // PwC". The set may be smaller than `cap` if the filter is restrictive.
  // v0.4.0 (ISC-373): owner is always in, unconditionally, AFTER candidate
  // selection. With a company filter active, owner may render disconnected
  // (their cluster colour empty) — that's the correct behaviour. The user
  // asked "who at X" and they aren't there.
  const filteredCandidates = allowedPersonIds
    ? candidates.filter((c) => allowedPersonIds!.has(c.person_id))
    : candidates;
  const selectedIds = new Set<string>();
  if (ownerId) selectedIds.add(ownerId);
  for (const c of filteredCandidates) {
    if (selectedIds.size >= cap) break;
    selectedIds.add(c.person_id);
  }

  if (selectedIds.size === 0) {
    return emptyAssembled(minConfidence, filteredCandidates.length);
  }

  // Fetch node metadata + each person's "current employer" for cluster colour.
  // v0.3.4 (ISC-354/355): the per-row correlated subquery for company_name
  // was the /graph TTFB bottleneck — for 150 nodes it ran 150 joins of
  // positions × companies + ORDER BY + LIMIT 1 in a tight loop. Replaced
  // with a single batched query using ROW_NUMBER() over the same ORDER BY
  // chain; then a Map join in JS. Selection rule unchanged: declared
  // positions before synthesised, current before past, most-recent
  // start_date first.
  const idsList = Array.from(selectedIds);
  const idsSqlList = sql.join(idsList.map((id) => sql`${id}`), sql`, `);
  const employerRows = await db.all<{
    person_id: string;
    company_name: string;
  }>(sql`
    WITH ranked AS (
      SELECT
        po.person_id,
        c.name AS company_name,
        ROW_NUMBER() OVER (
          PARTITION BY po.person_id
          ORDER BY
            CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
            po.current DESC,
            COALESCE(po.start_date, '0000-00-00') DESC,
            po.id ASC
        ) AS rn
      FROM positions po
      JOIN companies c ON c.id = po.company_id AND c.tenant_id = po.tenant_id
      WHERE po.tenant_id = ${tenantId}
        AND po.person_id IN (${idsSqlList})
    )
    SELECT person_id, company_name FROM ranked WHERE rn = 1
  `);
  const companyByPersonId = new Map<string, string>();
  for (const r of employerRows) companyByPersonId.set(r.person_id, r.company_name);
  const peopleRows = await db.all<{
    id: string;
    full_name: string;
  }>(sql`
    SELECT p.id, p.full_name
    FROM people p
    WHERE p.tenant_id = ${tenantId}
      AND p.id IN (${idsSqlList})
  `);
  const rawNodes = peopleRows.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    company_name: companyByPersonId.get(p.id) ?? null,
  }));

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
      candidateCount: filteredCandidates.length,
      selectedCount: nodes.length,
      totalEdges: finalEdges.length,
      // `edgesTotal` is the pre-cap count from the SQL fetch + manual edges
      // pre-min-degree. Only surfaces when actually larger than the rendered
      // set so the UI can show "M of N" only when the cap kicks in.
      edgesTotal: edgesTotal > finalEdges.length ? edgesTotal : undefined,
      // v0.4.0 (ISC-374): expose active filters only when overridden.
      ...(cap !== NODE_CAP ? { cap } : {}),
      ...(companyId
        ? { companyId, companyName: companyName ?? undefined, scope }
        : {}),
    },
  };
}
