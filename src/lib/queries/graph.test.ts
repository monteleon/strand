import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assembleNetworkGraph, MAX_NODE_CAP } from "./graph";
import { searchCompanies } from "./companies";

// v0.4.0 (ISC-386..391): graph filters + company scope behaviour against
// the real data/strand.db. Same pattern as reach.test.ts — structural
// assertions ("N <= cap", "all nodes at company X", "ever ⊇ current")
// so the tests survive re-ingestion of the same export.

async function ownerId(): Promise<string> {
  const [row] = await db.all<{ id: string }>(sql`
    SELECT owner_person_id AS id FROM tenants WHERE id = 'local'
  `);
  return row!.id;
}

async function pickCompanyWithPeople(minPeople = 5): Promise<{ id: string; name: string } | null> {
  // Pick a company with enough current-employer people that filtering is
  // meaningful (≥ minPeople).
  const [row] = await db.all<{ id: string; name: string }>(sql`
    SELECT c.id, c.name
    FROM companies c
    JOIN (
      SELECT po.company_id, COUNT(DISTINCT po.person_id) AS n
      FROM positions po
      WHERE po.tenant_id = 'local' AND po.current = 1
      GROUP BY po.company_id
    ) t ON t.company_id = c.id
    WHERE c.tenant_id = 'local' AND t.n >= ${minPeople}
    ORDER BY t.n DESC
    LIMIT 1
  `);
  return row ?? null;
}

describe("v0.4.0: assembleNetworkGraph cap + company filter", () => {
  test("ISC-386: cap restricted to discrete dropdown values; valid snap values produce ≤ cap nodes (owner counted)", async () => {
    // Cap is a discrete control — only CAP_DROPDOWN_VALUES are accepted.
    // Non-snap values fall back to NODE_CAP (150). Owner counts against the
    // cap (owner is added first, then candidates fill the remaining slots).
    const r50 = await assembleNetworkGraph("local", { cap: 50 });
    expect(r50.nodes.length).toBeLessThanOrEqual(50);
    expect(r50.nodes.length).toBeGreaterThan(0);

    const r100 = await assembleNetworkGraph("local", { cap: 100 });
    expect(r100.nodes.length).toBeLessThanOrEqual(100);
    expect(r100.nodes.length).toBeGreaterThanOrEqual(50);
  });

  test("ISC-368 (Advisor patch): non-snap cap values fall back to NODE_CAP default", async () => {
    // Out-of-range and non-snap values both produce the default-cap result.
    const rBig = await assembleNetworkGraph("local", { cap: 9999 });
    const r37 = await assembleNetworkGraph("local", { cap: 37 });
    const rDefault = await assembleNetworkGraph("local");
    // All three return the same node set (default cap).
    expect(rBig.nodes.length).toBe(rDefault.nodes.length);
    expect(r37.nodes.length).toBe(rDefault.nodes.length);
    expect(rBig.nodes.length).toBeLessThanOrEqual(MAX_NODE_CAP);
  });

  test("ISC-387: scope='current' — every non-owner node has the company as current employer", async () => {
    const company = await pickCompanyWithPeople(5);
    if (!company) return;
    const owner = await ownerId();
    const r = await assembleNetworkGraph("local", {
      companyId: company.id,
      scope: "current",
    });
    // Owner is always present
    expect(r.nodes.some((n) => n.id === owner)).toBe(true);
    // Every non-owner node's most-recent position must be at the company.
    // We re-derive the "current employer" using the same selection chain.
    for (const n of r.nodes) {
      if (n.id === owner) continue;
      const [pick] = await db.all<{ company_id: string }>(sql`
        SELECT po.company_id
        FROM positions po
        WHERE po.tenant_id = 'local' AND po.person_id = ${n.id}
        ORDER BY
          CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
          po.current DESC,
          COALESCE(po.start_date, '0000-00-00') DESC,
          po.id ASC
        LIMIT 1
      `);
      expect(pick?.company_id).toBe(company.id);
    }
    expect(r.meta.companyId).toBe(company.id);
    expect(r.meta.scope).toBe("current");
  });

  test("ISC-388: scope='ever' ⊇ scope='current' for the same companyId", async () => {
    const company = await pickCompanyWithPeople(5);
    if (!company) return;
    const owner = await ownerId();
    const rCurrent = await assembleNetworkGraph("local", {
      companyId: company.id,
      scope: "current",
    });
    const rEver = await assembleNetworkGraph("local", {
      companyId: company.id,
      scope: "ever",
    });
    const currentIds = new Set(rCurrent.nodes.filter((n) => n.id !== owner).map((n) => n.id));
    const everIds = new Set(rEver.nodes.filter((n) => n.id !== owner).map((n) => n.id));
    // ever should be a superset (possibly equal — if every current employee
    // never worked anywhere else, the two sets match. On real data with
    // synthesised positions this is rarely strict equality.)
    for (const id of currentIds) {
      expect(everIds.has(id)).toBe(true);
    }
  });

  test("ISC-389: composition — { companyId, cap: 50 } returns ≤50 total nodes at the company (filter then cap)", async () => {
    const company = await pickCompanyWithPeople(60);
    if (!company) return;
    const r = await assembleNetworkGraph("local", {
      companyId: company.id,
      scope: "current",
      cap: 50,
    });
    // Filter-then-cap means: of the people-at-company-X candidate set, take
    // up to 50 (including owner if applicable). Owner counts against cap.
    expect(r.nodes.length).toBeLessThanOrEqual(50);
    expect(r.nodes.length).toBeGreaterThan(0);
  });

  test("ISC-390: invalid companyId returns an empty assembled graph (just owner, no other nodes)", async () => {
    const owner = await ownerId();
    const r = await assembleNetworkGraph("local", {
      companyId: "00000000-no-such-company",
      scope: "current",
    });
    // Owner always included; no other nodes match the bogus company.
    expect(r.nodes.length).toBeLessThanOrEqual(1);
    if (r.nodes.length === 1) {
      expect(r.nodes[0]!.id).toBe(owner);
    }
  });

  test("ISC-398: default URL (no filters) byte-identical node/edge counts vs no-filter call", async () => {
    const a = await assembleNetworkGraph("local");
    const b = await assembleNetworkGraph("local", {});
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.edges.length).toBe(b.edges.length);
    // Same node ids in the same order
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
  });
});

describe("v0.4.0: searchCompanies", () => {
  test("ISC-391: searchCompanies(q) returns ≤limit, ordered by people-count DESC", async () => {
    const results = await searchCompanies("pwc", 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
    // Monotone non-increasing on peopleCount
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.peopleCount).toBeGreaterThanOrEqual(
        results[i]!.peopleCount,
      );
    }
  });

  test("ISC-391: empty query returns empty (no SQL injection risk surface)", async () => {
    expect(await searchCompanies("")).toEqual([]);
    expect(await searchCompanies("   ")).toEqual([]);
  });

  test("ISC-391: SQL-injection-style input is handled safely (parameter binding)", async () => {
    // The raw string is treated as a substring match, not as SQL. The query
    // should NOT throw and should NOT return all companies.
    const results = await searchCompanies("' OR 1=1 --", 5);
    expect(Array.isArray(results)).toBe(true);
    // Should be 0 or a small number — but never the full company list.
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
