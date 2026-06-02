// Helper for the typeahead / sidebar fetches that share the same
// `{ results: T[] }` envelope (e.g. /api/bookmarks, /api/people/search,
// /api/companies/search). Three layers of robustness the original
// `.then(r => r.json()).then(d => setX(d.results)).catch(() => {})` did
// NOT have:
//
//   1. res.ok check — a 5xx returns a Next-rendered HTML error page;
//      r.json() then rejects and the empty catch hides the failure. With
//      this helper, non-ok responses log once and return [].
//
//   2. Shape guard — an error envelope like `{ error: "..." }` from a
//      route's failure path used to land as `data.results === undefined`.
//      `setCandidates(undefined)` then made `candidates.length` evaluate
//      on `undefined` on the next render, raising a TypeError that
//      aborted the entire /graph filter panel. Now: any payload that
//      isn't `{ results: array }` returns [].
//
//   3. Abort silencing — AbortError is the typeahead's normal cancellation
//      signal; log it as noise free.
//
// On any failure the caller sees an empty array — same UX as the original
// "fail silently" intent, but observable via console for debugging.
//
// The `fetcher` parameter exists for unit tests; production callers pass
// nothing and get the global fetch.
type WithResults<T> = { results: T[] };

export async function fetchResults<T>(
  url: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    if (isAbortError(err)) return [];
    console.error(`[fetchResults] network error for ${url}`, err);
    return [];
  }
  if (!res.ok) {
    console.error(`[fetchResults] non-ok ${res.status} for ${url}`);
    return [];
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    if (isAbortError(err)) return [];
    console.error(`[fetchResults] json parse failed for ${url}`, err);
    return [];
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as Partial<WithResults<unknown>>).results)
  ) {
    console.error(`[fetchResults] unexpected shape for ${url}`, payload);
    return [];
  }
  return (payload as WithResults<T>).results;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  );
}
