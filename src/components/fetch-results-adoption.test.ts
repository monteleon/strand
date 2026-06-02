import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Structural regression for /code-review (re-run) finding #7 (review-#7).
// v0.4.12 (audit-#10) extracted fetchResults<T>() to retire the brittle
//   fetch(url).then(r=>r.json()).then(d=>setX(d.results)).catch(()=>{})
// pattern. Two consumer surfaces — src/components/person-picker.tsx and
// src/components/add-connection.tsx — were not migrated at the time;
// v0.4.19 migrates them. This file guards against a regression where
// someone reintroduces the raw pattern in a typeahead consumer.
//
// command-palette.tsx and company-picker.tsx also use fetchResults and
// are included so a future refactor that drops the helper from any
// typeahead is caught here, not in production.

const ADOPTERS = [
  "src/components/person-picker.tsx",
  "src/components/add-connection.tsx",
  "src/components/command-palette.tsx",
  "src/components/company-picker.tsx",
];

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";

describe("fetchResults adoption — typeahead components must use the helper", () => {
  for (const path of ADOPTERS) {
    test(`${path} imports fetchResults`, () => {
      const src = readFileSync(`${REPO_ROOT}/${path}`, "utf8");
      expect(src).toContain("fetchResults");
      expect(src).toMatch(/from\s+["']@\/lib\/fetch-results["']/);
    });

    test(`${path} has no raw \`.then((r) => r.json())\` typeahead pattern`, () => {
      const src = readFileSync(`${REPO_ROOT}/${path}`, "utf8");
      // The retired pattern. If a future change reintroduces it, the
      // audit-#10 failure class (5xx → setCandidates(undefined) →
      // TypeError on candidates.length) returns to that surface.
      expect(src).not.toMatch(/\.then\(\s*\(r\)\s*=>\s*r\.json\(\)\s*\)/);
    });
  }

  test("person-picker.tsx and add-connection.tsx use a cancelled guard around setCandidates", () => {
    // fetchResults swallows AbortError into []; an unguarded
    // .then(setCandidates) on the aborted promise can land after the
    // newer request's success and wipe the dropdown. The cancelled flag
    // pattern (same shape as command-palette.tsx) prevents that.
    for (const path of [
      "src/components/person-picker.tsx",
      "src/components/add-connection.tsx",
    ]) {
      const src = readFileSync(`${REPO_ROOT}/${path}`, "utf8");
      expect(src).toMatch(/let\s+cancelled\s*=\s*false/);
      expect(src).toMatch(/cancelled\s*=\s*true/);
      expect(src).toMatch(/if\s*\(\s*!cancelled\s*\)/);
    }
  });
});
