import { describe, expect, test } from "bun:test";
import { bucketise, overlapMonths } from "./edges";

const today = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01

const declared = (start: string | null, end: string | null, current: boolean) => ({
  personId: "x",
  companyId: "c",
  companyName: "Acme",
  startDate: start,
  endDate: end,
  current,
  origin: "declared" as const,
});

const synthesised = () => ({
  personId: "x",
  companyId: "c",
  companyName: "Acme",
  startDate: null,
  endDate: null,
  current: true,
  origin: "synthesised" as const,
});

describe("overlapMonths", () => {
  test("two declared with 24-month overlap → 24", () => {
    const a = declared("2018-01-01", "2022-01-01", false);
    const b = declared("2020-01-01", "2024-01-01", false);
    // overlap window: [2020-01, 2022-01] = 24 months
    expect(overlapMonths(a, b, today)).toBe(24);
  });

  test("two declared with no overlap → 0", () => {
    const a = declared("2018-01-01", "2019-01-01", false);
    const b = declared("2020-01-01", "2021-01-01", false);
    expect(overlapMonths(a, b, today)).toBe(0);
  });

  test("two synthesised → 0 (both collapse to today)", () => {
    expect(overlapMonths(synthesised(), synthesised(), today)).toBe(0);
  });

  test("owner declared past + connection synthesised → 0", () => {
    const a = declared("2018-01-01", "2023-04-01", false);
    expect(overlapMonths(a, synthesised(), today)).toBe(0);
  });

  test("owner declared current + connection synthesised → 0 (both at today)", () => {
    const a = declared("2024-09-01", null, true);
    expect(overlapMonths(a, synthesised(), today)).toBe(0);
  });

  test("brief 6-month overlap → 6", () => {
    const a = declared("2020-01-01", "2020-08-01", false);
    const b = declared("2020-03-01", "2021-01-01", false);
    expect(overlapMonths(a, b, today)).toBe(5);
  });
});

describe("bucketise", () => {
  test("≥12mo overlap → 0.9 / shared_employer_overlap", () => {
    expect(bucketise(24, false, 2)).toEqual({
      kind: "shared_employer_overlap",
      confidence: 0.9,
    });
  });

  test("1–11mo overlap → 0.7 / shared_employer_overlap", () => {
    expect(bucketise(5, false, 2)).toEqual({
      kind: "shared_employer_overlap",
      confidence: 0.7,
    });
  });

  test("0mo + not both current → 0.4 / shared_employer_no_overlap", () => {
    expect(bucketise(0, false, 1)).toEqual({
      kind: "shared_employer_no_overlap",
      confidence: 0.4,
    });
  });

  test("0mo + both current + 2 declared → 0.9 currently", () => {
    expect(bucketise(0, true, 2)).toEqual({
      kind: "shared_employer_currently",
      confidence: 0.9,
    });
  });

  test("0mo + both current + 1 declared → 0.7 currently", () => {
    expect(bucketise(0, true, 1)).toEqual({
      kind: "shared_employer_currently",
      confidence: 0.7,
    });
  });

  test("0mo + both current + 0 declared → 0.5 currently", () => {
    expect(bucketise(0, true, 0)).toEqual({
      kind: "shared_employer_currently",
      confidence: 0.5,
    });
  });
});
