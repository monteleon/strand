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

  test("ISC-319 (v0.3.2): 'mutuality' → mutuality", () => {
    expect(parseReachSort("mutuality")).toBe("mutuality");
    expect(parseReachSort(["mutuality"])).toBe("mutuality");
    expect(parseReachSort("MUTUALITY")).toBe("epistemic"); // case-sensitive
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

describe("v0.3.2: mutuality scalar + sort=mutuality mode", () => {
  test("ISC-308 / ISC-321: messages.mutuality === Math.min(sent, received) on every candidate", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const result = await findReachToPerson(targetId, "local", "mutuality");
    if (!result || result.status.kind !== "reach") return;
    expect(result.status.candidates.length).toBeGreaterThan(0);
    for (const c of result.status.candidates) {
      expect(typeof c.messages.mutuality).toBe("number");
      expect(c.messages.mutuality).toBe(
        Math.min(c.messages.sent, c.messages.received),
      );
      // Strictly one-way → mutuality is exactly zero
      if (c.messages.sent === 0 || c.messages.received === 0) {
        expect(c.messages.mutuality).toBe(0);
      }
    }
  });

  test("ISC-311 / ISC-320: sort='mutuality' — messages.mutuality DESC, NULLS-LAST on lastAt, zero-mutuality intermediaries fall to the bottom", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const result = await findReachToPerson(targetId, "local", "mutuality");
    if (!result || result.status.kind !== "reach") return;
    const cands = result.status.candidates;
    for (let i = 1; i < cands.length; i++) {
      const prev = cands[i - 1]!;
      const curr = cands[i]!;
      // Primary key: mutuality DESC
      expect(prev.messages.mutuality).toBeGreaterThanOrEqual(
        curr.messages.mutuality,
      );
      if (prev.messages.mutuality === curr.messages.mutuality) {
        // Secondary key: lastAt DESC with NULLS LAST
        const prevL = prev.messages.lastAt?.getTime() ?? -Infinity;
        const currL = curr.messages.lastAt?.getTime() ?? -Infinity;
        expect(prevL).toBeGreaterThanOrEqual(currL);
      }
    }
    // Zero-mutuality tail at the bottom (parallel to ISC-277 NULLS-LAST)
    let sawZero = false;
    for (const c of cands) {
      if (c.messages.mutuality === 0) sawZero = true;
      else if (sawZero) {
        throw new Error(
          `mutuality sort violated: zero-mutuality appeared before non-zero (target ${targetId})`,
        );
      }
    }
  });

  test("ISC-312 / ISC-313: sort='mutuality' does NOT alter score or messages.total", async () => {
    const targetId = await pickTargetWithReachCandidates();
    if (!targetId) return;
    const epi = await findReachToPerson(targetId, "local", "epistemic");
    const mut = await findReachToPerson(targetId, "local", "mutuality");
    if (!epi || epi.status.kind !== "reach") return;
    if (!mut || mut.status.kind !== "reach") return;
    const epiByCand = new Map(
      epi.status.candidates.map(
        (c) => [c.intermediaryId, { score: c.score, total: c.messages.total }],
      ),
    );
    for (const c of mut.status.candidates) {
      const prev = epiByCand.get(c.intermediaryId);
      expect(prev).toBeDefined();
      expect(c.score).toBe(prev!.score);
      expect(c.messages.total).toBe(prev!.total);
    }
    expect(mut.status.candidates.length).toBe(epi.status.candidates.length);
  });
});

// v0.3.2-A: adversarial reach fixtures. Pick targets meeting specific
// criteria from real data; honestly skip when the dataset has no such
// target (silent pass would mask a regression).

async function pickAllZeroWarmthTarget(): Promise<string | null> {
  // A target that has ≥3 reach candidates AND none of those candidates
  // have any messages with the owner.
  const rows = await db.all<{ target_id: string }>(sql`
    WITH owner AS (SELECT owner_person_id AS id FROM tenants WHERE id = 'local'),
    candidates AS (
      SELECT
        CASE WHEN e.person_a = c.to_person_id THEN e.person_b ELSE e.person_a END AS intermediary_id,
        CASE WHEN e.person_a = c.to_person_id THEN e.person_a ELSE e.person_b END AS target_id
      FROM derived_edges e
      JOIN connections c
        ON c.tenant_id = e.tenant_id
       AND c.from_person_id = (SELECT id FROM owner)
       AND (c.to_person_id = e.person_a OR c.to_person_id = e.person_b)
      WHERE e.tenant_id = 'local'
    )
    SELECT target_id
    FROM candidates
    WHERE intermediary_id != target_id
      AND target_id != (SELECT id FROM owner)
    GROUP BY target_id
    HAVING COUNT(*) >= 3
      AND SUM(
        CASE WHEN EXISTS (
          SELECT 1 FROM messages m
          WHERE m.tenant_id = 'local'
            AND (
              (m.direction = 'sent' AND m.to_person_id = intermediary_id) OR
              (m.direction = 'received' AND m.from_person_id = intermediary_id)
            )
        ) THEN 1 ELSE 0 END
      ) = 0
    LIMIT 1
  `);
  return rows[0]?.target_id ?? null;
}

describe("v0.3.3: fixture-skip meta-assertions (Advisor v0.3.2 conjecture #5)", () => {
  test("ISC-334: pickTargetWithReachCandidates() returns NON-NULL on current dataset — otherwise every adversarial test silently skips", async () => {
    const targetId = await pickTargetWithReachCandidates();
    expect(targetId).not.toBeNull();
    expect(typeof targetId).toBe("string");
  });

  test("ISC-335: divergent-rankings adversarial path is actually exercised (top-1 differs between epistemic and warmth on at least one target in top-20 by reach count) — NOT silently skipped", async () => {
    // Mirror the divergent-rankings test's sweep, but assert at least one
    // target qualifies. If the dataset has no divergent target, the meta-
    // assertion fails loudly here rather than letting the adversarial test
    // pass via the silent "no candidates qualified" branch.
    const rows = await db.all<{ target_id: string }>(sql`
      WITH owner AS (SELECT owner_person_id AS id FROM tenants WHERE id = 'local')
      SELECT t.target_id
      FROM (
        SELECT
          CASE WHEN e.person_a = c.to_person_id THEN e.person_b ELSE e.person_a END AS intermediary_id,
          CASE WHEN e.person_a = c.to_person_id THEN e.person_a ELSE e.person_b END AS target_id
        FROM derived_edges e
        JOIN connections c
          ON c.tenant_id = e.tenant_id
         AND c.from_person_id = (SELECT id FROM owner)
         AND (c.to_person_id = e.person_a OR c.to_person_id = e.person_b)
        WHERE e.tenant_id = 'local'
      ) t
      WHERE t.intermediary_id != t.target_id
        AND t.target_id != (SELECT id FROM owner)
      GROUP BY t.target_id
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    let divergentFound = false;
    for (const r of rows) {
      const epi = await findReachToPerson(r.target_id, "local", "epistemic");
      const wrm = await findReachToPerson(r.target_id, "local", "warmth");
      if (!epi || epi.status.kind !== "reach") continue;
      if (!wrm || wrm.status.kind !== "reach") continue;
      const epiTop = epi.status.candidates[0]?.intermediaryId;
      const wrmTop = wrm.status.candidates[0]?.intermediaryId;
      if (epiTop && wrmTop && epiTop !== wrmTop) {
        divergentFound = true;
        break;
      }
    }
    // Loud assertion: if no divergent target qualified, the divergent
    // adversarial test in the v0.3.2 suite is silently skipping every run.
    expect(divergentFound).toBe(true);
  });
});

describe("v0.3.2: adversarial reach fixtures", () => {
  test("ISC-303: all-zero-warmth target — toggle still renders; sort=epistemic and sort=warmth produce IDENTICAL orderings (no message tiebreak signal)", async () => {
    const targetId = await pickAllZeroWarmthTarget();
    if (!targetId) {
      console.log(
        "ISC-303 skip — no all-zero-warmth target with ≥3 candidates in dataset",
      );
      return;
    }
    const epi = await findReachToPerson(targetId, "local", "epistemic");
    const wrm = await findReachToPerson(targetId, "local", "warmth");
    if (!epi || epi.status.kind !== "reach") return;
    if (!wrm || wrm.status.kind !== "reach") return;
    // All warmth.total === 0 across candidates
    for (const c of epi.status.candidates) {
      expect(c.messages.total).toBe(0);
      expect(c.messages.mutuality).toBe(0);
      expect(c.messages.lastAt).toBeNull();
    }
    // With no message signal, warmth and epistemic produce the SAME order —
    // both fall through to the score → lastAt-via-(-Infinity)-tie →
    // score-tiebreak → name chain.
    expect(wrm.status.candidates.map((c) => c.intermediaryId)).toEqual(
      epi.status.candidates.map((c) => c.intermediaryId),
    );
  });

  test("ISC-304 / ISC-305: divergent rankings — find a target where sort=epistemic top-1 ≠ sort=warmth top-1, or honestly skip", async () => {
    // Sweep up to 20 candidates-with-reach until we find one where the
    // rankings diverge at the top. Honest skip if none qualifies.
    const rows = await db.all<{ target_id: string }>(sql`
      WITH owner AS (SELECT owner_person_id AS id FROM tenants WHERE id = 'local')
      SELECT t.target_id
      FROM (
        SELECT
          CASE WHEN e.person_a = c.to_person_id THEN e.person_b ELSE e.person_a END AS intermediary_id,
          CASE WHEN e.person_a = c.to_person_id THEN e.person_a ELSE e.person_b END AS target_id
        FROM derived_edges e
        JOIN connections c
          ON c.tenant_id = e.tenant_id
         AND c.from_person_id = (SELECT id FROM owner)
         AND (c.to_person_id = e.person_a OR c.to_person_id = e.person_b)
        WHERE e.tenant_id = 'local'
      ) t
      WHERE t.intermediary_id != t.target_id
        AND t.target_id != (SELECT id FROM owner)
      GROUP BY t.target_id
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    for (const r of rows) {
      const epi = await findReachToPerson(r.target_id, "local", "epistemic");
      const wrm = await findReachToPerson(r.target_id, "local", "warmth");
      if (!epi || epi.status.kind !== "reach") continue;
      if (!wrm || wrm.status.kind !== "reach") continue;
      const epiTop = epi.status.candidates[0]?.intermediaryId;
      const wrmTop = wrm.status.candidates[0]?.intermediaryId;
      if (epiTop && wrmTop && epiTop !== wrmTop) {
        // Same candidate set; different top-1 — feature visibly diverges
        expect(epi.status.candidates.length).toBe(wrm.status.candidates.length);
        expect(epiTop).not.toBe(wrmTop);
        return;
      }
    }
    console.log(
      "ISC-304 skip — no divergent-top target in top-20 by reach count (dataset may have only-one-warm-intermediary structure)",
    );
  });
});
