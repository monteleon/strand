import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { findReachToPerson, parseReachSort } from "./reach";

// v0.3.0-C tests run against the real data/strand.db (same pattern as
// messages.test.ts). Assertions are structural: "every candidate has the
// warmth field", "warmth sort puts higher-total before lower-total",
// "epistemic sort byte-identical regardless of warmth values". These
// survive re-ingestion as long as the dataset still has people + edges.

async function pickTargetWithReachCandidates(): Promise<string | null> {
  // Find a target X with at least 3 reach candidates (more chance of having
  // mixed warmth values across the candidate set). Picks the X with the
  // largest derived-edge in-degree from people who are also 1st-degree
  // connections of the owner.
  const rows = await db.all<{ target_id: string; n: number }>(sql`
    SELECT t.target_id, COUNT(*) AS n
    FROM (
      SELECT
        CASE WHEN e.person_a = c.to_person_id THEN e.person_b ELSE e.person_a END AS intermediary_id,
        CASE WHEN e.person_a = c.to_person_id THEN e.person_a ELSE e.person_b END AS target_id
      FROM derived_edges e
      JOIN tenants tn ON tn.id = e.tenant_id
      JOIN connections c
        ON c.tenant_id = e.tenant_id
       AND c.from_person_id = tn.owner_person_id
       AND (c.to_person_id = e.person_a OR c.to_person_id = e.person_b)
      WHERE e.tenant_id = 'local'
    ) t
    WHERE t.intermediary_id != t.target_id
      AND t.target_id != (SELECT owner_person_id FROM tenants WHERE id = 'local')
    GROUP BY t.target_id
    HAVING COUNT(*) >= 3
    ORDER BY n DESC
    LIMIT 1
  `);
  return rows[0]?.target_id ?? null;
}

describe("v0.3.0-C: parseReachSort", () => {
  test("ISC-274: unknown / undefined / null → epistemic (forgiving fallback)", () => {
    expect(parseReachSort(undefined)).toBe("epistemic");
    expect(parseReachSort("")).toBe("epistemic");
    expect(parseReachSort("garbage")).toBe("epistemic");
    expect(parseReachSort("' OR 1=1 --")).toBe("epistemic");
    expect(parseReachSort("EPISTEMIC")).toBe("epistemic"); // case-sensitive on purpose
  });

  test("ISC-282: 'warmth' → warmth", () => {
    expect(parseReachSort("warmth")).toBe("warmth");
  });

  test("ISC-274: array → first element wins (Next.js searchParams type)", () => {
    expect(parseReachSort(["warmth", "epistemic"])).toBe("warmth");
    expect(parseReachSort(["bogus"])).toBe("epistemic");
  });
});

describe("v0.3.0-C: findReachToPerson — warmth composition + sort modes", () => {
  test("ISC-273: every candidate has a `messages` field (always present, zero-when-none)", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) {
      // No candidates in dataset — feature is still typed correctly; skip.
      return;
    }
    const result = await findReachToPerson(targetId);
    expect(result).not.toBeNull();
    if (!result || result.status.kind !== "reach") return;
    expect(result.status.candidates.length).toBeGreaterThan(0);
    for (const c of result.status.candidates) {
      expect(c.messages).toBeDefined();
      expect(typeof c.messages.sent).toBe("number");
      expect(typeof c.messages.received).toBe("number");
      expect(typeof c.messages.total).toBe("number");
      // total = sent + received invariant
      expect(c.messages.sent + c.messages.received).toBe(c.messages.total);
      // lastAt is either a Date or null — never undefined
      expect(c.messages.lastAt === null || c.messages.lastAt instanceof Date).toBe(true);
      // ISC-278: warmth never mixes into score
      expect(typeof c.score).toBe("number");
      expect(c.score).toBeGreaterThan(0);
    }
  });

  test("ISC-276: sort='epistemic' (default) — ordering is score DESC, manual-before-derived tiebreak", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const result = await findReachToPerson(targetId, "local", "epistemic");
    if (!result || result.status.kind !== "reach") return;
    const cands = result.status.candidates;
    for (let i = 1; i < cands.length; i++) {
      const prev = cands[i - 1]!;
      const curr = cands[i]!;
      // Score monotone non-increasing
      expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      // At equal score, manual beats derived
      if (prev.score === curr.score && prev.via !== curr.via) {
        expect(prev.via).toBe("manual");
      }
    }
  });

  test("ISC-276: default arg = 'epistemic' produces same ordering as explicit 'epistemic'", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const a = await findReachToPerson(targetId);
    const b = await findReachToPerson(targetId, "local", "epistemic");
    if (!a || a.status.kind !== "reach") return;
    if (!b || b.status.kind !== "reach") return;
    expect(a.status.candidates.map((c) => c.intermediaryId)).toEqual(
      b.status.candidates.map((c) => c.intermediaryId),
    );
  });

  test("ISC-277: sort='warmth' — messages.total DESC, NULLS-LAST on lastAt", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const result = await findReachToPerson(targetId, "local", "warmth");
    if (!result || result.status.kind !== "reach") return;
    const cands = result.status.candidates;
    for (let i = 1; i < cands.length; i++) {
      const prev = cands[i - 1]!;
      const curr = cands[i]!;
      // Primary key: total DESC
      expect(prev.messages.total).toBeGreaterThanOrEqual(curr.messages.total);
      if (prev.messages.total === curr.messages.total) {
        // Secondary key: lastAt DESC with NULLS LAST
        const prevL = prev.messages.lastAt?.getTime() ?? -Infinity;
        const currL = curr.messages.lastAt?.getTime() ?? -Infinity;
        expect(prevL).toBeGreaterThanOrEqual(currL);
      }
    }
  });

  test("ISC-277: warmth-sort zero-message intermediaries fall to the bottom", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const result = await findReachToPerson(targetId, "local", "warmth");
    if (!result || result.status.kind !== "reach") return;
    const cands = result.status.candidates;
    let sawZero = false;
    for (const c of cands) {
      if (c.messages.total === 0) sawZero = true;
      else if (sawZero) {
        // A non-zero appeared AFTER a zero — would break NULLS-LAST.
        throw new Error(
          `warmth sort violated: zero-total appeared before non-zero (target ${targetId})`,
        );
      }
    }
  });

  test("ISC-278: sort mode does NOT alter the `score` field on any candidate", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const epi = await findReachToPerson(targetId, "local", "epistemic");
    const wrm = await findReachToPerson(targetId, "local", "warmth");
    if (!epi || epi.status.kind !== "reach") return;
    if (!wrm || wrm.status.kind !== "reach") return;
    // Build maps by intermediaryId and verify scores match across both modes
    const epiScores = new Map(
      epi.status.candidates.map((c) => [c.intermediaryId, c.score]),
    );
    for (const c of wrm.status.candidates) {
      const epiScore = epiScores.get(c.intermediaryId);
      expect(epiScore).toBeDefined();
      expect(c.score).toBe(epiScore!);
    }
    // Symmetric: same candidate ID set across modes
    expect(wrm.status.candidates.length).toBe(epi.status.candidates.length);
  });
});
