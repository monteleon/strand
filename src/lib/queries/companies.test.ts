import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listAtCompany, type AtCompanyRow } from "./companies";
import { PAGE_SIZE } from "@/lib/pagination";

// v0.4.x (ISC-420..431): listAtCompany pagination — audit finding (A).
// Same pattern as graph.test.ts / reach.test.ts: structural assertions
// against the real data/strand.db so the tests survive re-ingestion of the
// same export. Pagination math is asserted against listAtCompany's own
// returned `total`, never a hand-computed count, so the connections
// LEFT JOIN row shape can't desync the expectation from the implementation.

// Pick the company with the most positions (status='any') so pagination is
// actually exercised. Honest-skip if the real export has no company at all.
async function pickLargestCompany(): Promise<{ id: string; n: number } | null> {
  const [row] = await db.all<{ id: string; n: number }>(sql`
    SELECT po.company_id AS id, COUNT(*) AS n
    FROM positions po
    INNER JOIN people p ON p.id = po.person_id AND p.tenant_id = po.tenant_id
    WHERE po.tenant_id = 'local'
    GROUP BY po.company_id
    ORDER BY n DESC
    LIMIT 1
  `);
  return row ? { id: row.id, n: Number(row.n) } : null;
}

describe("v0.4.x: listAtCompany pagination (audit-A)", () => {
  test("ISC-420/424: page 1 returns at most PAGE_SIZE rows", async () => {
    const big = await pickLargestCompany();
    if (!big) return; // honest skip — empty dataset
    const r = await listAtCompany(big.id, "any", "declared-first", 1);
    expect(r.rows.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(r.total).toBeGreaterThan(0);
    expect(r.totalPages).toBe(Math.max(1, Math.ceil(r.total / PAGE_SIZE)));
  });

  test("ISC-421: page slices sum to exactly `total` across all pages", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const first = await listAtCompany(big.id, "any", "name", 1);
    let summed = 0;
    for (let p = 1; p <= first.totalPages; p++) {
      const r = await listAtCompany(big.id, "any", "name", p);
      expect(r.rows.length).toBeLessThanOrEqual(PAGE_SIZE);
      // every page but the last is a full page
      if (p < first.totalPages) expect(r.rows.length).toBe(PAGE_SIZE);
      summed += r.rows.length;
    }
    expect(summed).toBe(first.total);
  });

  test("ISC-422: last-page remainder matches total modulo PAGE_SIZE", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const first = await listAtCompany(big.id, "any", "name", 1);
    const last = await listAtCompany(big.id, "any", "name", first.totalPages);
    const expectedLast =
      first.total - (first.totalPages - 1) * PAGE_SIZE;
    expect(last.rows.length).toBe(expectedLast);
  });

  test("ISC-423: hasPrev/hasNext flags correct at both boundaries", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const r1 = await listAtCompany(big.id, "any", "name", 1);
    expect(r1.hasPrev).toBe(false);
    expect(r1.hasNext).toBe(r1.totalPages > 1);
    const last = await listAtCompany(big.id, "any", "name", r1.totalPages);
    expect(last.hasNext).toBe(false);
    expect(last.hasPrev).toBe(r1.totalPages > 1);
  });

  test("ISC-425: total counts the full filtered set (any ⊇ current)", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const any = await listAtCompany(big.id, "any", "name", 1);
    const cur = await listAtCompany(big.id, "current", "name", 1);
    const past = await listAtCompany(big.id, "past", "name", 1);
    expect(any.total).toBeGreaterThanOrEqual(cur.total);
    expect(any.total).toBe(cur.total + past.total);
  });

  test("ISC-426: declared-first ordering holds across the full concatenation", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const all: AtCompanyRow[] = [];
    const first = await listAtCompany(big.id, "any", "declared-first", 1);
    for (let p = 1; p <= first.totalPages; p++) {
      const r = await listAtCompany(big.id, "any", "declared-first", p);
      all.push(...r.rows);
    }
    // once a synthesised row appears, no declared row may follow it
    let sawSynthesised = false;
    for (const row of all) {
      if (row.origin === "synthesised") {
        sawSynthesised = true;
      } else {
        expect(sawSynthesised).toBe(false);
      }
    }
  });

  test("ISC-427: out-of-range page returns empty rows but the real total", async () => {
    const big = await pickLargestCompany();
    if (!big) return;
    const r = await listAtCompany(big.id, "any", "name", 9999);
    expect(r.rows.length).toBe(0);
    expect(r.total).toBeGreaterThan(0);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(true);
  });

  test("ISC-428: unknown company id returns an empty, well-formed page", async () => {
    const r = await listAtCompany("no-such-company", "any", "name", 1);
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(false);
  });
});
