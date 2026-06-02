import { describe, expect, test } from "bun:test";
import { escapeLikePattern } from "./like";

describe("escapeLikePattern", () => {
  test("plain string passes through unchanged", () => {
    expect(escapeLikePattern("acme")).toBe("acme");
    expect(escapeLikePattern("acme corp")).toBe("acme corp");
    expect(escapeLikePattern("")).toBe("");
  });

  test("% escapes to \\% (any-sequence wildcard neutralised)", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("foo%bar")).toBe("foo\\%bar");
    expect(escapeLikePattern("%%%%")).toBe("\\%\\%\\%\\%");
  });

  test("_ escapes to \\_ (single-char wildcard neutralised)", () => {
    expect(escapeLikePattern("_")).toBe("\\_");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("___")).toBe("\\_\\_\\_");
  });

  test("backslashes are doubled BEFORE wildcard escaping (so the doubling is not re-escaped)", () => {
    expect(escapeLikePattern("\\")).toBe("\\\\");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    // A literal backslash followed by % must not collapse to an escape of %
    // — the backslash should remain a literal, and the % should be escaped
    // separately. Both \\ and \% appear in the output.
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  test("mixed wildcards + plain chars escape all wildcards", () => {
    expect(escapeLikePattern("a%b_c")).toBe("a\\%b\\_c");
    expect(escapeLikePattern("100% _correct")).toBe("100\\% \\_correct");
  });

  test("escaped form is safe for `LIKE ${pattern} ESCAPE '\\\\'` (idempotency probe)", () => {
    // Applying the escape twice doubles literal backslashes again but does
    // NOT add second-layer escapes to % or _ (they're already preceded by a
    // literal backslash, which becomes \\\\, so the % stays escaped as \\\\\\%).
    const once = escapeLikePattern("a%b_c\\d");
    const twice = escapeLikePattern(once);
    expect(once).toBe("a\\%b\\_c\\\\d");
    expect(twice).toBe("a\\\\\\%b\\\\\\_c\\\\\\\\d");
  });
});
