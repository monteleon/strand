import { describe, expect, test } from "bun:test";
import { parseCompanyParam } from "./graph-filters";

// v0.4.5 (/code-review finding #9): `/graph?company=` (explicit empty value)
// must clear the filter, NOT silently fall back to the SSR-seeded
// initialCompanyId — the user put the param in the URL deliberately. The
// pre-fix expression `searchParams.get("company")?.trim() || null ??
// initialCompanyId` failed this because `||` short-circuited the empty
// string before `??` could distinguish absent-vs-present-empty.

const INITIAL = "init-company-id";

describe("parseCompanyParam — present-empty vs absent semantics", () => {
  test("the bug case: ?company= (explicit empty) → null (CLEARS, not fall back)", () => {
    expect(parseCompanyParam("", INITIAL)).toBeNull();
  });

  test("?company=   (whitespace only) → null (treated as empty intent)", () => {
    expect(parseCompanyParam("   ", INITIAL)).toBeNull();
  });

  test("no `company` param at all (raw === null) → initialCompanyId fallback", () => {
    expect(parseCompanyParam(null, INITIAL)).toBe(INITIAL);
  });

  test("no `company` param AND no initialCompanyId → null", () => {
    expect(parseCompanyParam(null, null)).toBeNull();
  });

  test("?company=ID → trimmed ID", () => {
    expect(parseCompanyParam("ID", INITIAL)).toBe("ID");
  });

  test("?company=  ID   (whitespace around real value) → trimmed", () => {
    expect(parseCompanyParam("  ID   ", INITIAL)).toBe("ID");
  });

  test("present value overrides initialCompanyId", () => {
    expect(parseCompanyParam("override", INITIAL)).toBe("override");
  });
});
