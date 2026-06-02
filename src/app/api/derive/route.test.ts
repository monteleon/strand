import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Regression for /code-review finding #13 (single-flight) and the v0.4.14
// follow-up (review-#2): the single-flight gate now lives in
// @/lib/derived/edges so ingest.ts goes through it too. The route's job is
// (a) reject fail-fast with 409 if the lock is held, (b) wrap throws in a
// JSON error envelope so a deriver crash doesn't become Next's default
// HTML 500 page.

// The DB-dependent imports are mocked so the test doesn't need migrations
// or seeded data.

type DeriveResult = {
  kept: number;
  scannedPairs: number;
  ms: number;
  byKind: Record<string, number>;
};

let pendingResolver: ((v: DeriveResult) => void) | null = null;
let pendingRejector: ((e: Error) => void) | null = null;
let deriveCallCount = 0;
let lockInFlight = false;

mock.module("@/lib/derived/edges", () => ({
  isDeriveInFlight: () => lockInFlight,
  runDeriveSerialized: async <T>(work: () => Promise<T>): Promise<T> => {
    lockInFlight = true;
    try {
      return await work();
    } finally {
      lockInFlight = false;
    }
  },
  deriveSharedEmployerEdges: () => {
    deriveCallCount++;
    return new Promise<DeriveResult>((resolve, reject) => {
      pendingResolver = resolve;
      pendingRejector = reject;
    });
  },
  countDerivedEdges: () => Promise.resolve({}),
}));

async function loadFreshRoute() {
  // bun caches modules; force a fresh load by appending a query so any
  // module-level state in route.ts resets between test groups.
  return import(`./route?t=${Date.now()}`);
}

describe("/api/derive — single-flight via shared lock (finding #13 + review-#2)", () => {
  beforeEach(() => {
    pendingResolver = null;
    pendingRejector = null;
    deriveCallCount = 0;
    lockInFlight = false;
  });
  afterEach(() => {
    // Drain any unresolved derive so a failed test doesn't leak.
    pendingResolver?.({ kept: 0, scannedPairs: 0, ms: 0, byKind: {} });
    pendingResolver = null;
    pendingRejector = null;
  });

  test("first POST runs the derive and returns 200", async () => {
    const { POST } = await loadFreshRoute();
    const inflight = POST();
    // Wait one microtask so runDeriveSerialized has had a chance to call work()
    await Promise.resolve();
    expect(pendingResolver).not.toBeNull();
    pendingResolver!({ kept: 7, scannedPairs: 10, ms: 5, byKind: { shared_employer_overlap: 7 } });
    const res = await inflight;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kept: number; byKind: Record<string, number> };
    expect(body.kept).toBe(7);
    expect(deriveCallCount).toBe(1);
  });

  test("second POST while first is in-flight returns 409 and does NOT call the deriver again", async () => {
    const { POST } = await loadFreshRoute();
    const first = POST();
    // Yield so runDeriveSerialized flips the flag and calls work()
    await Promise.resolve();
    expect(deriveCallCount).toBe(1);
    expect(lockInFlight).toBe(true);

    // Second POST immediately — sees the lock held, short-circuits.
    const secondRes = await POST();
    expect(secondRes.status).toBe(409);
    const body = (await secondRes.json()) as { error: string };
    expect(body.error).toBe("derive_in_progress");
    expect(deriveCallCount).toBe(1);

    pendingResolver!({ kept: 0, scannedPairs: 0, ms: 1, byKind: {} });
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });

  test("third POST after the first resolves succeeds (lock releases in finally)", async () => {
    const { POST } = await loadFreshRoute();
    const first = POST();
    await Promise.resolve();
    pendingResolver!({ kept: 1, scannedPairs: 1, ms: 1, byKind: {} });
    await first;
    expect(deriveCallCount).toBe(1);
    expect(lockInFlight).toBe(false);

    // Second invocation after the first drained.
    const second = POST();
    await Promise.resolve();
    expect(deriveCallCount).toBe(2);
    pendingResolver!({ kept: 2, scannedPairs: 2, ms: 1, byKind: {} });
    const secondRes = await second;
    expect(secondRes.status).toBe(200);
  });

  test("100 concurrent POSTs admit exactly ONE derive — the loop case from the finding", async () => {
    const { POST } = await loadFreshRoute();
    const calls = Array.from({ length: 100 }, () => POST());
    // Yield enough microtasks for runDeriveSerialized to flip the lock
    // and the subsequent isDeriveInFlight checks to see it.
    await Promise.resolve();
    await Promise.resolve();
    expect(deriveCallCount).toBe(1);

    pendingResolver!({ kept: 0, scannedPairs: 0, ms: 1, byKind: {} });
    const responses = await Promise.all(calls);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(99);
  });

  test("derive throw produces JSON 500, not Next default HTML — and lock releases (review-#2 part B)", async () => {
    const { POST } = await loadFreshRoute();
    const inflight = POST();
    await Promise.resolve();
    expect(pendingRejector).not.toBeNull();

    pendingRejector!(new Error("SQLITE_BUSY: database is locked"));
    const res = await inflight;
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("derive_failed");
    expect(body.detail).toContain("SQLITE_BUSY");

    // Lock must release on throw so the next POST isn't stuck at 409 forever.
    expect(lockInFlight).toBe(false);

    // Fresh POST proceeds.
    const second = POST();
    await Promise.resolve();
    expect(deriveCallCount).toBe(2);
    pendingResolver!({ kept: 0, scannedPairs: 0, ms: 1, byKind: {} });
    const secondRes = await second;
    expect(secondRes.status).toBe(200);
  });
});
