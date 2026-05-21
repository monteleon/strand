// W5b — "strongest reach to X" query. The path Strand can honestly compute is
// owner → Y → X where Y is a 1st-degree connection of the owner and Y has an
// edge (manual or derived) to X. Score per intermediary Y:
//   - manual_edge(Y, X) → 1.0   (owner asserted Y knows X)
//   - else max derived.confidence across (Y, X) derived edges
// Manual edges always rank above derived (epistemic preference: asserted >
// inferred). Within derived, ties broken by overlap_months desc.
import { and, eq, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { getOwnerId } from "./people";
import {
  getMessageCountsByPeople,
  listLastContactByPeople,
} from "./messages";

// v0.3.0-C: warmth is a third epistemic category. It is observed (frequency +
// recency of past messages with the intermediary), not asserted/inferred.
// Composed onto every candidate ALWAYS (zero-when-none); never blended into
// `score`. The `sort` param is the user's question: "rank by epistemic
// strength (default)" vs "rank by relationship warmth".
export type ReachSort = "epistemic" | "warmth";

export type ReachCandidate = {
  intermediaryId: string;
  intermediaryName: string;
  intermediaryHeadline: string | null;
  via: "manual" | "derived";
  score: number;
  // v0.3.0-C: warmth signal. ALWAYS present on every candidate (render-zeros-
  // not-absence — see feedback_render_zeros_not_absence.md). Zero-message
  // intermediaries get {sent:0, received:0, total:0, lastAt:null}.
  messages: {
    sent: number;
    received: number;
    total: number;
    lastAt: Date | null;
  };
  // For manual edges: the user's note (may be null).
  note?: string | null;
  // For derived edges: the strongest single edge's evidence.
  companyId?: string | null;
  companyName?: string | null;
  overlapMonths?: number;
  bothCurrent?: boolean;
};

// `directConnection` and `candidates` are independent — for v1 every non-owner
// person in `people` is by definition a 1st-degree connection of the owner
// (the schema is populated from Connections.csv), so the "direct" fact alone
// is rarely the answer the user wants. The useful question is "who else in my
// network ALSO knows X?" — surfacing intermediaries lets the owner pick a
// co-introducer or sanity-check who would vouch.
export type ReachStatus =
  | { kind: "self" }
  | {
      kind: "reach";
      directConnection: { connectedAt: string | null } | null;
      candidates: ReachCandidate[];
    };

export type ReachResult = {
  target: { id: string; fullName: string; headline: string | null };
  status: ReachStatus;
};

// v0.3.0-C: sort param is forgiving — unknown / undefined / null falls back
// to "epistemic" (matches ISC-257 unknown-sort safety from v0.3.0-B).
export function parseReachSort(raw: string | string[] | undefined): ReachSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "warmth" ? "warmth" : "epistemic";
}

export async function findReachToPerson(
  targetId: string,
  tenantId: string = LOCAL_TENANT_ID,
  sort: ReachSort = "epistemic",
): Promise<ReachResult | null> {
  const [target] = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.tenantId, tenantId), eq(schema.people.id, targetId)))
    .limit(1);
  if (!target) return null;

  const ownerId = await getOwnerId(tenantId);

  // X = owner.
  if (ownerId && target.id === ownerId) {
    return {
      target: { id: target.id, fullName: target.fullName, headline: target.headline },
      status: { kind: "self" },
    };
  }

  // Direct-connection fact is *informational* — it does NOT short-circuit
  // the candidate search. Owner can be directly connected to X AND still
  // want to know which mutuals could vouch / co-introduce.
  let directConnection: { connectedAt: string | null } | null = null;
  if (ownerId) {
    const [direct] = await db
      .select({ connectedAt: schema.connections.connectedAt })
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.tenantId, tenantId),
          eq(schema.connections.fromPersonId, ownerId),
          eq(schema.connections.toPersonId, target.id),
        ),
      )
      .limit(1);
    if (direct) directConnection = { connectedAt: direct.connectedAt ?? null };
  }

  // Manual edges incident to X where the OTHER side is a 1st-degree
  // connection of the owner AND not X himself (ISC-139 / ISC-140).
  // Manual edges win at score 1.0.
  const manualRows = await db.all<{
    other_id: string;
    other_name: string;
    other_headline: string | null;
    note: string | null;
  }>(sql`
    SELECT
      CASE WHEN me.person_a = ${targetId} THEN me.person_b ELSE me.person_a END AS other_id,
      p.full_name AS other_name,
      p.headline AS other_headline,
      me.note
    FROM manual_edges me
    JOIN people p ON p.id = (CASE WHEN me.person_a = ${targetId} THEN me.person_b ELSE me.person_a END)
    WHERE me.tenant_id = ${tenantId}
      AND (me.person_a = ${targetId} OR me.person_b = ${targetId})
      AND ${ownerId
        ? sql`EXISTS (
            SELECT 1 FROM connections c
            WHERE c.tenant_id = ${tenantId}
              AND c.from_person_id = ${ownerId}
              AND c.to_person_id = (CASE WHEN me.person_a = ${targetId} THEN me.person_b ELSE me.person_a END)
          )`
        : sql`1=0`}
  `);

  // Derived edges incident to X where the other side is a 1st-degree
  // connection. We keep the strongest single derived edge per intermediary
  // (max confidence; tie-break by overlap_months desc).
  const derivedRows = await db.all<{
    other_id: string;
    other_name: string;
    other_headline: string | null;
    kind: string;
    confidence: number;
    company_id: string | null;
    company_name: string | null;
    overlap_months: number | null;
    both_current: number | null;
  }>(sql`
    SELECT
      CASE WHEN e.person_a = ${targetId} THEN e.person_b ELSE e.person_a END AS other_id,
      p.full_name AS other_name,
      p.headline AS other_headline,
      e.kind,
      e.confidence,
      json_extract(e.evidence_json, '$.companyId') AS company_id,
      json_extract(e.evidence_json, '$.companyName') AS company_name,
      CAST(json_extract(e.evidence_json, '$.overlapMonths') AS INTEGER) AS overlap_months,
      json_extract(e.evidence_json, '$.bothCurrent') AS both_current
    FROM derived_edges e
    JOIN people p ON p.id = (CASE WHEN e.person_a = ${targetId} THEN e.person_b ELSE e.person_a END)
    WHERE e.tenant_id = ${tenantId}
      AND (e.person_a = ${targetId} OR e.person_b = ${targetId})
      AND ${ownerId
        ? sql`EXISTS (
            SELECT 1 FROM connections c
            WHERE c.tenant_id = ${tenantId}
              AND c.from_person_id = ${ownerId}
              AND c.to_person_id = (CASE WHEN e.person_a = ${targetId} THEN e.person_b ELSE e.person_a END)
          )`
        : sql`1=0`}
  `);

  // Merge by intermediary_id: manual wins over derived; within derived,
  // pick strongest single edge.
  const byIntermediary = new Map<string, ReachCandidate>();

  for (const m of manualRows) {
    if (m.other_id === targetId) continue; // belt-and-braces (ISC-139)
    byIntermediary.set(m.other_id, {
      intermediaryId: m.other_id,
      intermediaryName: m.other_name,
      intermediaryHeadline: m.other_headline,
      via: "manual",
      score: 1.0,
      messages: { sent: 0, received: 0, total: 0, lastAt: null },
      note: m.note,
    });
  }
  for (const d of derivedRows) {
    if (d.other_id === targetId) continue;
    const prior = byIntermediary.get(d.other_id);
    if (prior?.via === "manual") continue; // manual already wins
    const months = d.overlap_months ?? 0;
    if (!prior || d.confidence > prior.score || (d.confidence === prior.score && months > (prior.overlapMonths ?? 0))) {
      byIntermediary.set(d.other_id, {
        intermediaryId: d.other_id,
        intermediaryName: d.other_name,
        intermediaryHeadline: d.other_headline,
        via: "derived",
        score: d.confidence,
        messages: { sent: 0, received: 0, total: 0, lastAt: null },
        companyId: d.company_id,
        companyName: d.company_name,
        overlapMonths: months,
        bothCurrent: d.both_current === 1,
      });
    }
  }

  // v0.3.0-C: compose warmth via two batch calls (ISC-274 / ISC-275 — no
  // N+1). Intermediaries with no message history keep their zero defaults
  // (ISC-273 — render-zeros-not-absence per
  // feedback_render_zeros_not_absence.md). reach.ts NEVER touches the
  // `messages` table directly — ISC-289 SQL-reference grep enforces.
  const intermediaryIds = Array.from(byIntermediary.keys());
  if (intermediaryIds.length > 0) {
    const [counts, lastContacts] = await Promise.all([
      getMessageCountsByPeople(intermediaryIds, tenantId),
      listLastContactByPeople(intermediaryIds, tenantId),
    ]);
    for (const id of intermediaryIds) {
      const cand = byIntermediary.get(id);
      if (!cand) continue;
      const c = counts.get(id);
      const lastAt = lastContacts.get(id) ?? null;
      if (c || lastAt) {
        cand.messages = {
          sent: c?.sent ?? 0,
          received: c?.received ?? 0,
          total: c?.total ?? 0,
          lastAt,
        };
      }
    }
  }

  const candidates = Array.from(byIntermediary.values()).sort((a, b) => {
    // v0.3.0-C: ISC-277 — warmth ordering by messages.total DESC, then
    // messages.lastAt DESC (nulls last), then epistemic score DESC, then
    // name ASC. ISC-278 — warmth NEVER mixes into `score`; both fields
    // stay independent on every candidate.
    if (sort === "warmth") {
      if (b.messages.total !== a.messages.total) {
        return b.messages.total - a.messages.total;
      }
      const aLast = a.messages.lastAt?.getTime() ?? -Infinity;
      const bLast = b.messages.lastAt?.getTime() ?? -Infinity;
      if (bLast !== aLast) return bLast - aLast;
      if (b.score !== a.score) return b.score - a.score;
      return a.intermediaryName.localeCompare(b.intermediaryName);
    }
    // sort === "epistemic" (default) — pre-v0.3.0-C behaviour byte-identical
    // (ISC-276 regression-safety claim).
    if (b.score !== a.score) return b.score - a.score;
    // Manual ranks above derived at the same score (defensive: should not
    // happen since manual is fixed at 1.0).
    if (a.via !== b.via) return a.via === "manual" ? -1 : 1;
    const am = a.overlapMonths ?? 0;
    const bm = b.overlapMonths ?? 0;
    if (bm !== am) return bm - am;
    return a.intermediaryName.localeCompare(b.intermediaryName);
  });

  return {
    target: { id: target.id, fullName: target.fullName, headline: target.headline },
    status: { kind: "reach", directConnection, candidates },
  };
}
