import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isDeriveInFlight, runDeriveSerialized } from "./edges";

// Unit tests for the module-level derive lock (review-#2). The lock lives
// in @/lib/derived/edges so every caller — POST /api/derive AND the
// implicit derive at the end of ingest — goes through the same gate.
// Prior to v0.4.14 the gate was at the route handler only; ingest.ts
// bypassed it.

describe("runDeriveSerialized + isDeriveInFlight (review-#2)", () => {
  test("isDeriveInFlight is false when no work is queued", () => {
    expect(isDeriveInFlight()).toBe(false);
  });

  test("concurrent calls never overlap — the lock is exclusive", async () => {
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    };
    await Promise.all([
      runDeriveSerialized(work),
      runDeriveSerialized(work),
      runDeriveSerialized(work),
      runDeriveSerialized(work),
    ]);
    expect(maxActive).toBe(1);
    expect(isDeriveInFlight()).toBe(false);
  });

  test("isDeriveInFlight is true while work is queued, false after drain", async () => {
    let resolveFirst!: () => void;
    const firstStarted = runDeriveSerialized(
      () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
    );
    // First call has acquired the counter synchronously before returning.
    expect(isDeriveInFlight()).toBe(true);

    // Second caller queues — counter goes to 2.
    let resolveSecond!: () => void;
    const secondStarted = runDeriveSerialized(
      () => new Promise<void>((resolve) => { resolveSecond = resolve; }),
    );
    expect(isDeriveInFlight()).toBe(true);

    // Yield so the chain advances and work() is actually invoked, setting
    // resolveFirst.
    await Promise.resolve();
    await Promise.resolve();
    resolveFirst!();
    await firstStarted;
    // First done, but second is still queued — flag remains true.
    expect(isDeriveInFlight()).toBe(true);

    // Yield so second's work() actually runs.
    await Promise.resolve();
    await Promise.resolve();
    resolveSecond!();
    await secondStarted;
    expect(isDeriveInFlight()).toBe(false);
  });

  test("a thrown work does not poison subsequent calls", async () => {
    await expect(
      runDeriveSerialized(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(isDeriveInFlight()).toBe(false);

    let observed = 0;
    await runDeriveSerialized(async () => { observed++; });
    expect(observed).toBe(1);
    expect(isDeriveInFlight()).toBe(false);
  });

  test("callers run in submission order (FIFO chain)", async () => {
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runDeriveSerialized(async () => {
          order.push(i);
          await new Promise((r) => setTimeout(r, 5));
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

// Structural assertion: both the derive route AND the ingest path import
// runDeriveSerialized from the lock module. If either bypasses it, two
// clear-then-rebuild passes can interleave and corrupt derived_edges.
describe("derive lock altitude — every caller goes through the gate", () => {
  test("api/derive/route.ts imports isDeriveInFlight and runDeriveSerialized", () => {
    const src = readFileSync("/mnt/c/Users/mca/Projects/Strand/src/app/api/derive/route.ts", "utf8");
    expect(src).toContain("isDeriveInFlight");
    expect(src).toContain("runDeriveSerialized");
  });

  test("lib/linkedin/ingest.ts wraps deriveSharedEmployerEdges with runDeriveSerialized", () => {
    const src = readFileSync("/mnt/c/Users/mca/Projects/Strand/src/lib/linkedin/ingest.ts", "utf8");
    expect(src).toContain("runDeriveSerialized");
    // The pre-v0.4.14 bare call shape must NOT survive — bypassing the lock
    // is the bug; this guard catches a regression where someone reverts the
    // wrapper "for simplicity".
    expect(src).not.toMatch(/await\s+deriveSharedEmployerEdges\s*\(/);
  });
});
