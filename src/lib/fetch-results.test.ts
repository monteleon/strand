import { describe, expect, mock, test, beforeEach } from "bun:test";
import { fetchResults } from "./fetch-results";

// Silence the helper's console.error during tests — they're intentional
// failure paths and the noise is not the assertion.
const consoleErrorSpy = mock(() => {});
beforeEach(() => {
  consoleErrorSpy.mockClear();
});
console.error = consoleErrorSpy;

type Person = { id: string; fullName: string };

function makeResponse(body: unknown, init: { status?: number; ok?: boolean; json?: () => Promise<unknown> } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: init.json ?? (async () => body),
  } as unknown as Response;
}

function fetcherReturning(res: Response | (() => Promise<Response>)): typeof fetch {
  return (async () => {
    return typeof res === "function" ? await res() : res;
  }) as unknown as typeof fetch;
}

describe("fetchResults — happy path", () => {
  test("returns the results array from a 200 { results } envelope", async () => {
    const fetcher = fetcherReturning(
      makeResponse({ results: [{ id: "a", fullName: "Alice" }, { id: "b", fullName: "Bob" }] }),
    );
    const out = await fetchResults<Person>("/api/people", undefined, fetcher);
    expect(out).toEqual([{ id: "a", fullName: "Alice" }, { id: "b", fullName: "Bob" }]);
  });

  test("returns [] when results is empty", async () => {
    const fetcher = fetcherReturning(makeResponse({ results: [] }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });
});

describe("fetchResults — shape guard (finding #10 second failure mode)", () => {
  test("returns [] when payload is an error envelope without results (was: setCandidates(undefined) → TypeError)", async () => {
    const fetcher = fetcherReturning(makeResponse({ error: "boom" }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("returns [] when results is null", async () => {
    const fetcher = fetcherReturning(makeResponse({ results: null }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });

  test("returns [] when results is the wrong type (string)", async () => {
    const fetcher = fetcherReturning(makeResponse({ results: "not an array" }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });

  test("returns [] when payload is null", async () => {
    const fetcher = fetcherReturning(makeResponse(null));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });

  test("returns [] when payload is a bare array (no envelope)", async () => {
    const fetcher = fetcherReturning(makeResponse([{ id: "a", fullName: "Alice" }]));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });
});

describe("fetchResults — non-ok responses (finding #10 first failure mode)", () => {
  test("returns [] on 500 without throwing", async () => {
    const fetcher = fetcherReturning(makeResponse({ error: "Internal Server Error" }, { status: 500 }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("returns [] on 404 without throwing", async () => {
    const fetcher = fetcherReturning(makeResponse(null, { status: 404 }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });

  test("returns [] on 403 without throwing", async () => {
    const fetcher = fetcherReturning(makeResponse(null, { status: 403 }));
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });
});

describe("fetchResults — network errors", () => {
  test("network failure returns [] (was: caught + swallowed silently)", async () => {
    const fetcher = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("AbortError is silent (no console noise, returns [])", async () => {
    consoleErrorSpy.mockClear();
    const fetcher = (async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("JSON parse failure returns []", async () => {
    const fetcher = fetcherReturning(
      makeResponse(null, {
        status: 200,
        ok: true,
        json: async () => { throw new Error("invalid json"); },
      }),
    );
    expect(await fetchResults<Person>("/api/people", undefined, fetcher)).toEqual([]);
  });
});

describe("fetchResults — passes init through", () => {
  test("AbortController.signal is forwarded to fetcher", async () => {
    const ctrl = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fetcher = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
      receivedSignal = init?.signal;
      return makeResponse({ results: [] });
    }) as unknown as typeof fetch;
    await fetchResults<Person>("/api/people", { signal: ctrl.signal }, fetcher);
    expect(receivedSignal).toBe(ctrl.signal);
  });
});
