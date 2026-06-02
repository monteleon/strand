import { beforeEach, describe, expect, mock, test } from "bun:test";

// Regression for /code-review (re-run) finding #4 (review-#4). POST has
// re-validated URLs through isLocalAppPath since v0.4.9, but GET served
// stored rows verbatim. Pre-v0.4.9 bookmarks (or rows written via
// direct DB access) could carry malicious URLs that command-palette
// then handed to router.push() on click → off-origin navigation.
// Fix: GET filters rows through isLocalAppPath before serving.

type SavedQuery = {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
};

let rowsToReturn: SavedQuery[] = [];

mock.module("@/lib/queries/savedQueries", () => ({
  listSavedQueries: () => Promise.resolve(rowsToReturn),
  createSavedQuery: () =>
    Promise.resolve({ kind: "duplicate_name" as const }),
}));

async function loadFreshRoute() {
  return import(`./route?t=${Date.now()}`);
}

describe("GET /api/bookmarks — re-validate stored URLs (review-#4)", () => {
  beforeEach(() => {
    rowsToReturn = [];
  });

  test("safe rows pass through unchanged", async () => {
    rowsToReturn = [
      { id: "a", name: "Companies", url: "/companies",          createdAt: new Date("2026-01-01") },
      { id: "b", name: "At PwC",    url: "/queries/at-company?company=co1", createdAt: new Date("2026-01-02") },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string; url: string }> };
    expect(body.results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("protocol-relative `//evil.com` is filtered out", async () => {
    rowsToReturn = [
      { id: "ok",  name: "OK",   url: "/companies",      createdAt: new Date() },
      { id: "bad", name: "Evil", url: "//evil.com/pwn",  createdAt: new Date() },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: Array<{ id: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.id).toBe("ok");
  });

  test("backslash-prefix `/\\evil.com` (browser-normalised to `//evil.com`) is filtered out", async () => {
    rowsToReturn = [
      { id: "bad", name: "Evil", url: "/\\evil.com/pwn", createdAt: new Date() },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("absolute external URL is filtered out", async () => {
    rowsToReturn = [
      { id: "bad", name: "Evil", url: "https://evil.com/pwn", createdAt: new Date() },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("javascript: scheme is filtered out", async () => {
    rowsToReturn = [
      { id: "bad", name: "Evil", url: "javascript:alert(1)", createdAt: new Date() },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("data: scheme is filtered out", async () => {
    rowsToReturn = [
      { id: "bad", name: "Evil", url: "data:text/html,<script>alert(1)</script>", createdAt: new Date() },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("mixed safe + poisoned set — only safe rows surface", async () => {
    rowsToReturn = [
      { id: "a",   name: "OK 1",  url: "/people",            createdAt: new Date("2026-01-01") },
      { id: "bad1", name: "Bad 1", url: "//evil.com",         createdAt: new Date("2026-01-02") },
      { id: "b",    name: "OK 2",  url: "/companies",         createdAt: new Date("2026-01-03") },
      { id: "bad2", name: "Bad 2", url: "javascript:void(0)", createdAt: new Date("2026-01-04") },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: Array<{ id: string }> };
    const ids = body.results.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  test("createdAt is still serialised to ISO string for safe rows", async () => {
    const when = new Date("2026-03-15T12:00:00Z");
    rowsToReturn = [
      { id: "a", name: "OK", url: "/people", createdAt: when },
    ];
    const { GET } = await loadFreshRoute();
    const res = await GET();
    const body = (await res.json()) as { results: Array<{ createdAt: string }> };
    expect(body.results[0]!.createdAt).toBe(when.toISOString());
  });
});
