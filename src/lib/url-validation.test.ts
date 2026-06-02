import { describe, expect, test } from "bun:test";
import { isLocalAppPath } from "./url-validation";

describe("isLocalAppPath — accepts legitimate same-origin paths", () => {
  test("plain path", () => {
    expect(isLocalAppPath("/foo")).toBe(true);
  });
  test("nested path", () => {
    expect(isLocalAppPath("/queries/at-company/co-pwc-espana")).toBe(true);
  });
  test("path with query", () => {
    expect(isLocalAppPath("/people?q=alice&sort=name")).toBe(true);
  });
  test("path with fragment", () => {
    expect(isLocalAppPath("/graph#selected=person-1")).toBe(true);
  });
  test("path with query AND fragment", () => {
    expect(isLocalAppPath("/companies?q=foo#first")).toBe(true);
  });
  test("path containing percent-encoded backslash (literal, not normalised by parser)", () => {
    // %5C is the URL-encoded form of `\`. It stays a path-component literal
    // and does NOT trigger WHATWG normalisation, so origin is preserved.
    expect(isLocalAppPath("/%5Cevil.com")).toBe(true);
  });
  test("path containing a colon mid-path (not a scheme since prefixed by /)", () => {
    expect(isLocalAppPath("/javascript:alert(1)")).toBe(true);
  });
  test("path containing the word 'evil' is fine — only origin matters", () => {
    expect(isLocalAppPath("/evil.com")).toBe(true);
  });
});

describe("isLocalAppPath — rejects the finding-#11 bug shapes", () => {
  test("the canonical bug case — `/\\evil.com` (backslash → browser normalises to `//`)", () => {
    expect(isLocalAppPath("/\\evil.com")).toBe(false);
  });
  test("`/\\\\evil.com` (double backslash) — same browser normalisation defeat", () => {
    expect(isLocalAppPath("/\\\\evil.com")).toBe(false);
  });
});

describe("isLocalAppPath — rejects the already-blocked protocol-relative shapes", () => {
  test("`//evil.com`", () => {
    expect(isLocalAppPath("//evil.com")).toBe(false);
  });
  test("`///evil.com` (three slashes — WHATWG also resolves off-origin)", () => {
    expect(isLocalAppPath("///evil.com")).toBe(false);
  });
});

describe("isLocalAppPath — rejects non-path forms", () => {
  test("explicit https URL", () => {
    expect(isLocalAppPath("https://evil.com")).toBe(false);
  });
  test("explicit http URL", () => {
    expect(isLocalAppPath("http://evil.com/path")).toBe(false);
  });
  test("javascript: URI (no `/` prefix → fails the gate)", () => {
    expect(isLocalAppPath("javascript:alert(1)")).toBe(false);
  });
  test("data: URI", () => {
    expect(isLocalAppPath("data:text/html,<script>alert(1)</script>")).toBe(false);
  });
  test("scheme-relative-looking input without leading slash (\\foo) — gate rejects on prefix", () => {
    // The URL parser happens to resolve `\\foo` (one literal backslash + foo)
    // as same-origin, but the literal-`/`-prefix gate rejects it. Bookmark
    // surfaces should not accept anything that doesn't visibly start with `/`.
    expect(isLocalAppPath("\\foo")).toBe(false);
  });
  test("input without leading slash (foo)", () => {
    expect(isLocalAppPath("foo")).toBe(false);
  });
});

describe("isLocalAppPath — empty / whitespace inputs", () => {
  test("empty string", () => {
    expect(isLocalAppPath("")).toBe(false);
  });
  test("whitespace-only string (not pre-trimmed)", () => {
    // The bookmarks route trims before calling this — but the helper itself
    // must still reject untrimmed whitespace if a caller forgets.
    expect(isLocalAppPath("   ")).toBe(false);
  });
});
