import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Regression for /code-review (re-run) finding #10. Migration 0005
// promoted derived_edges.company_id to a real NOT NULL column and added
// `derived_edges_company_idx` on (tenant_id, company_id). The performance
// rationale was that per-company filters (e.g. /companies/[id] listing
// derived pairs) could index-seek instead of full-table-scan + JSON
// parse. But three read sites continued to filter / project companyId
// via `json_extract(e.evidence_json, '$.companyId')` — SQLite cannot use
// the new index against a JSON expression, so the migration's
// performance promise was unrealised at the reader.
//
// v0.4.22 swaps the JSON extract for the column. This test guards the
// regression by file-grep: any read site that goes back to
// json_extract(..., '$.companyId') drops the index from the query plan
// silently.

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const READERS = [
  "src/lib/queries/derivedEdges.ts",
  "src/lib/queries/reach.ts",
  "src/lib/queries/graph.ts",
];

describe("derived_edges readers — use company_id column, not json_extract (review-#10)", () => {
  for (const path of READERS) {
    test(`${path} does NOT json_extract '$.companyId'`, () => {
      const src = readFileSync(`${REPO_ROOT}/${path}`, "utf8");
      // The retired pattern. Whitespace-tolerant so a reformat doesn't
      // false-pass.
      expect(src).not.toMatch(/json_extract\([^)]*'\$\.companyId'\s*\)/);
    });
  }

  test("derivedEdges.ts filter (listDerivedPairsAtCompany) uses e.company_id, enabling derived_edges_company_idx", () => {
    const src = readFileSync(`${REPO_ROOT}/src/lib/queries/derivedEdges.ts`, "utf8");
    expect(src).toMatch(/e\.company_id\s*=\s*\$\{companyId\}/);
  });

  // Non-companyId json_extract sites (companyName, overlapMonths, bothCurrent)
  // are intentionally NOT swept. They're not on the audit's perf hot path
  // — the migration only promoted companyId to a column. Future migrations
  // can promote others as needed.
  test("non-companyId json_extracts are still permitted (companyName, overlapMonths, bothCurrent)", () => {
    const src = readFileSync(`${REPO_ROOT}/src/lib/queries/derivedEdges.ts`, "utf8");
    expect(src).toContain("json_extract(e.evidence_json, '$.companyName')");
  });
});
