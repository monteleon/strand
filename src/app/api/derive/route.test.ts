import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Regression for /code-review finding #13. The route used to accept any
// number of concurrent POSTs; each one ran the full derive pass and
// monopolised the single SQLite writer. The fix is a single-flight in-flight
// Promise — first POST runs, subsequent POSTs return 409 until it resolves.

// The DB-dependent imports are mocked so the test doesn't need migrations
// or seeded data. The fix lives entirely in the route's concurrency
// control; the deriver itself is unchanged.

type DeriveResult = {
  kept: number;
  scannedPairs: number;
  ms: number;
  byKind: Record<string, number>;
};

let pendingResolver: ((v: DeriveResult) => void) | null = null;
let deriveCallCount = 0;

mock.module("@/lib/derived/edges", () => ({
  deriveSharedEmployerEdges: () => {
    deriveCallCount++;
    return new Promise<DeriveResult>((resolve) => {
      pendingResolver = resolve;
    });
  },
  countDerivedEdges: () => Promise.resolve({}),
}));

// Import AFTER the mock so route.ts picks up the stubbed deriver. The
// dynamic import is required because the route's module-level `inFlight`
// singleton would otherwise carry state across describe blocks.
async function loadFreshRoute() {
  // bun caches modules; force a fresh load by appending a query so the
  // module-level `inFlight` resets between test groups.
  return import(`./route?t=${Date.now()}`);
}

describe("/api/derive — single-flight (finding #13)", () => {
  beforeEach(() => {
    pendingResolver = null;
    deriveCallCount = 0;
  });
  afterEach(() => {
    // Drain any unresolved derive so a failed test doesn't leak.
    pendingResolver?.({ kept: 0, scannedPairs: 0, ms: 0, byKind: {} });
    pendingResolver = null;
  });

  test("first POST runs the derive and returns 200", async () => {
    const { POST } = await loadFreshRoute();
    const inflight = POST();
    expect(pendingResolver).not.toBeNull();
    pendingResolver!({ kept: 7, scannedPairs: 10, ms: 5, byKind: { shared_employer_overlap: 7 } });
    const res = await inflight;
    expect(res.status).toBe(200);
    const body = await res.json() as { kept: number; byKind: Record<string, number> };
    expect(body.kept).toBe(7);
    expect(deriveCallCount).toBe(1);
  });

  test("second POST while first is in-flight returns 409 and does NOT call the deriver again", async () => {
    const { POST } = await loadFreshRoute();
    const first = POST();
    // Sanity: first invocation registered the deriver call and is waiting.
    expect(deriveCallCount).toBe(1);
    expect(pendingResolver).not.toBeNull();

    // Second POST immediately — the singleton is set, must short-circuit.
    const secondRes = await POST();
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json() as { error: string };
    expect(body.error).toBe("derive_in_progress");
    // Deriver was NOT called a second time — the writer is not double-booked.
    expect(deriveCallCount).toBe(1);

    // Drain the first so the test completes deterministically.
    pendingResolver!({ kept: 0, scannedPairs: 0, ms: 1, byKind: {} });
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });

  test("third POST after the first resolves succeeds (singleton resets in finally)", async () => {
    const { POST } = await loadFreshRoute();
    const first = POST();
    pendingResolver!({ kept: 1, scannedPairs: 1, ms: 1, byKind: {} });
    await first;
    expect(deriveCallCount).toBe(1);

    // Second invocation after the first drained — singleton is null again,
    // a new derive is admitted.
    const second = POST();
    expect(deriveCallCount).toBe(2);
    pendingResolver!({ kept: 2, scannedPairs: 2, ms: 1, byKind: {} });
    const secondRes = await second;
    expect(secondRes.status).toBe(200);
  });

  test("100 concurrent POSTs admit exactly ONE derive — the loop case from the finding", async () => {
    const { POST } = await loadFreshRoute();
    // Fire 100 POSTs in parallel. Pre-fix every one of them would call the
    // deriver; post-fix only the first wins and the other 99 short-circuit
    // to 409 without touching the writer.
    const calls = Array.from({ length: 100 }, () => POST());
    // Wait for all the short-circuits to land before resolving the first.
    // The 409 calls do not await the deriver, so they resolve synchronously
    // after their `inFlight` check. A single microtask drain is enough.
    await Promise.resolve();
    expect(deriveCallCount).toBe(1);

    pendingResolver!({ kept: 0, scannedPairs: 0, ms: 1, byKind: {} });
    const responses = await Promise.all(calls);
    const statuses = responses.map((r) => r.status).sort();
    // One 200 for the winner, ninety-nine 409s for the rest.
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(99);
  });
});
