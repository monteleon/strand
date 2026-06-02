// Derive shared-employer edges for the tenant. The LinkedIn export does not
// expose the 2nd-degree graph; everything in here is *inferred* from positions
// that share a company_id. Confidence is bucketed (0.9 / 0.7 / 0.4) — kept
// honest about the underlying signal strength.
//
// Math: each position has an interval [start, end]. Null-date rule — if a
// position has null start AND null end (synthesised from a connection's
// company text), treat it as ongoing today (start = today, end = today).
// If `current=true` with null end, treat end = today.
//
// Pair generation: group positions by (tenant, company), then nested-loop
// within each company group. Skip self-loops (same personId). Canonicalise
// to person_a < person_b lex. Aggregate by (person_a, person_b) within a
// company taking the max overlap (a person can have multiple positions at
// the same company).
//
// Owner exclusion: 1st-degree connections to the owner are already in the
// `connections` table; they're not derived. The owner's positions are kept
// in the pair pool, though, so derived edges *between two connections* at
// the owner's former employer still emerge.

import { and, eq, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";

// Three honest kinds:
//   shared_employer_overlap   — real overlap math, ≥1 month of co-employment
//                               proven by date intervals (high evidence)
//   shared_employer_currently — both positions current=true at the same
//                               company but dates are unknown or collapsed
//                               to a single instant (medium evidence:
//                               concurrency now, no duration)
//   shared_employer_no_overlap — same employer in different time windows,
//                               no overlap, not currently both there (weak)
export type DerivedEdgeKind =
  | "shared_employer_overlap"
  | "shared_employer_currently"
  | "shared_employer_no_overlap";

export type DeriveResult = {
  kept: number;
  scannedPairs: number;
  ms: number;
  byKind: Record<DerivedEdgeKind, number>;
};

type PositionRow = {
  personId: string;
  companyId: string;
  companyName: string | null;
  startDate: string | null; // YYYY-MM-01
  endDate: string | null;
  current: boolean;
  origin: "declared" | "synthesised";
};

// Parse YYYY-MM-01 into a Date at UTC midnight. Null returns null.
function parseMonth(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function startOf(p: PositionRow, today: Date): Date {
  const s = parseMonth(p.startDate);
  if (s) return s;
  return today;
}

function endOf(p: PositionRow, today: Date): Date {
  const e = parseMonth(p.endDate);
  if (e) return e;
  if (p.current) return today;
  return today;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function overlapMonths(a: PositionRow, b: PositionRow, today: Date): number {
  const aStart = startOf(a, today);
  const aEnd = endOf(a, today);
  const bStart = startOf(b, today);
  const bEnd = endOf(b, today);
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  return Math.max(0, monthsBetween(start, end));
}

// Bucket the (overlap_months, both_currently_there) signal into a kind +
// confidence label. The "currently together" override matters because
// synthesised positions collapse to a single instant in the overlap math —
// without it, every connection-vs-connection pair at the same current
// company is reported as no-overlap (factually wrong: LinkedIn says they
// BOTH work there NOW). The override is honest about the signal we have:
// we know the *fact* of co-employment now, we don't know the *duration*.
export function bucketise(
  months: number,
  bothCurrent: boolean,
  declaredCount: 0 | 1 | 2,
): { kind: DerivedEdgeKind; confidence: number } {
  // Real overlap math (≥1 month with date intervals on both sides).
  if (months >= 12) return { kind: "shared_employer_overlap", confidence: 0.9 };
  if (months >= 1) return { kind: "shared_employer_overlap", confidence: 0.7 };
  // bothCurrent path — concurrency is real, duration is unknown. Distinct
  // kind so the data is honest about what we're claiming.
  if (bothCurrent) {
    // declaredCount=2 → both owners declared current at company → 0.9
    // declaredCount=1 → one declared, one synthesised, both current → 0.7
    // declaredCount=0 → both synthesised, same current employer → 0.5
    const conf = declaredCount === 2 ? 0.9 : declaredCount === 1 ? 0.7 : 0.5;
    return { kind: "shared_employer_currently", confidence: conf };
  }
  return { kind: "shared_employer_no_overlap", confidence: 0.4 };
}

export async function deriveSharedEmployerEdges(
  tenantId: string = LOCAL_TENANT_ID,
  now: Date = new Date(),
): Promise<DeriveResult> {
  const t0 = Date.now();

  // Today as YYYY-MM-01 — month precision matches the export.
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  // Pull every position row (with the joined company name) for the tenant.
  const rows = await db
    .select({
      personId: schema.positions.personId,
      companyId: schema.positions.companyId,
      companyName: schema.companies.name,
      startDate: schema.positions.startDate,
      endDate: schema.positions.endDate,
      current: schema.positions.current,
      origin: schema.positions.origin,
    })
    .from(schema.positions)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.positions.companyId))
    .where(eq(schema.positions.tenantId, tenantId));

  // Group by company_id.
  const byCompany = new Map<string, PositionRow[]>();
  for (const r of rows) {
    const list = byCompany.get(r.companyId);
    const row: PositionRow = {
      personId: r.personId,
      companyId: r.companyId,
      companyName: r.companyName,
      startDate: r.startDate,
      endDate: r.endDate,
      current: r.current,
      origin: r.origin as "declared" | "synthesised",
    };
    if (list) list.push(row);
    else byCompany.set(r.companyId, [row]);
  }

  // Best-overlap-per-pair-per-company, then emit edges.
  // Pair key is `personA|personB|companyId`; canonical order enforced by the
  // sorted peopleHere array.
  type PairAcc = {
    personA: string;
    personB: string;
    companyId: string;
    companyName: string | null;
    months: number;
    bothCurrent: boolean;
    declaredCount: 0 | 1 | 2;
    aPositions: PositionRow[];
    bPositions: PositionRow[];
  };
  const bestByPair = new Map<string, PairAcc>();

  let scannedPairs = 0;
  for (const [companyId, list] of byCompany) {
    if (list.length < 2) continue;
    const byPerson = new Map<string, PositionRow[]>();
    for (const r of list) {
      const ps = byPerson.get(r.personId);
      if (ps) ps.push(r);
      else byPerson.set(r.personId, [r]);
    }
    const peopleHere = Array.from(byPerson.keys()).sort();
    for (let i = 0; i < peopleHere.length; i++) {
      for (let j = i + 1; j < peopleHere.length; j++) {
        scannedPairs++;
        const aId = peopleHere[i];
        const bId = peopleHere[j];
        const aPositions = byPerson.get(aId)!;
        const bPositions = byPerson.get(bId)!;
        let bestMonths = 0;
        let bothCurrent = false;
        let bestDeclaredCount: 0 | 1 | 2 = 0;
        for (const a of aPositions) {
          for (const b of bPositions) {
            const m = overlapMonths(a, b, today);
            if (m > bestMonths) bestMonths = m;
            if (a.current && b.current) bothCurrent = true;
            const declaredHere: 0 | 1 | 2 = (
              (a.origin === "declared" ? 1 : 0) +
              (b.origin === "declared" ? 1 : 0)
            ) as 0 | 1 | 2;
            if (declaredHere > bestDeclaredCount) bestDeclaredCount = declaredHere;
          }
        }
        const key = `${aId}|${bId}|${companyId}`;
        const prior = bestByPair.get(key);
        const acc: PairAcc = {
          personA: aId,
          personB: bId,
          companyId,
          companyName: aPositions[0]?.companyName ?? bPositions[0]?.companyName ?? null,
          months: bestMonths,
          bothCurrent,
          declaredCount: bestDeclaredCount,
          aPositions,
          bPositions,
        };
        if (!prior || prior.months < acc.months) bestByPair.set(key, acc);
      }
    }
  }

  // Clear-then-rebuild: derive is idempotent over the current data, and if
  // positions changed (a re-ingest, a manual edit) stale edges should not
  // linger. The whole pass is fast enough that this is cheap.
  await db
    .delete(schema.derivedEdges)
    .where(eq(schema.derivedEdges.tenantId, tenantId));

  let kept = 0;
  const byKind: Record<DerivedEdgeKind, number> = {
    shared_employer_overlap: 0,
    shared_employer_currently: 0,
    shared_employer_no_overlap: 0,
  };

  // Batch the inserts — at ~16k pairs, serial awaits add up to minutes.
  // libSQL/SQLite caps parameter count at 999 per statement; with 7 cols
  // per row that's ~140 rows per chunk. 100 is a safe margin.
  const CHUNK = 100;
  const buffer: (typeof schema.derivedEdges.$inferInsert)[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    await db
      .insert(schema.derivedEdges)
      .values(buffer)
      .onConflictDoNothing();
    buffer.length = 0;
  };
  for (const acc of bestByPair.values()) {
    if (acc.personA === acc.personB) continue; // belt-and-braces self-loop guard
    const { kind, confidence } = bucketise(acc.months, acc.bothCurrent, acc.declaredCount);
    const evidence = JSON.stringify({
      companyId: acc.companyId,
      companyName: acc.companyName,
      overlapMonths: acc.months,
      bothCurrent: acc.bothCurrent,
      declaredCount: acc.declaredCount,
      aPositions: acc.aPositions.map((p) => ({
        startDate: p.startDate,
        endDate: p.endDate,
        current: p.current,
        origin: p.origin,
      })),
      bPositions: acc.bPositions.map((p) => ({
        startDate: p.startDate,
        endDate: p.endDate,
        current: p.current,
        origin: p.origin,
      })),
    });
    buffer.push({
      tenantId,
      personA: acc.personA,
      personB: acc.personB,
      kind,
      companyId: acc.companyId,
      evidenceJson: evidence,
      confidence,
      derivedAt: now,
    });
    kept++;
    byKind[kind]++;
    if (buffer.length >= CHUNK) await flush();
  }
  await flush();

  return {
    kept,
    scannedPairs,
    ms: Date.now() - t0,
    byKind,
  };
}

// Sum-by-kind probe used by tests + the API route's response.
export async function countDerivedEdges(tenantId: string = LOCAL_TENANT_ID) {
  const rows = await db.all<{ kind: DerivedEdgeKind; n: number }>(sql`
    SELECT kind, COUNT(*) AS n
    FROM derived_edges
    WHERE tenant_id = ${tenantId}
    GROUP BY kind
  `);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r.n;
  return out;
}
