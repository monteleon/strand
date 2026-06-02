import { describe, expect, test } from "bun:test";
import { schema } from "@/lib/db";

// Regression for /code-review (re-run) finding #9. The 0005 migration
// added derived_edges.company_id NOT NULL with the rationale that every
// shared_employer_* kind has a single companyId. The kind enum, however,
// also listed `connection_date_cluster` — a future date-clustering
// kind that by definition is cross-employer and would have no
// companyId. If a producer for that kind ever landed, every emitted row
// would violate the NOT NULL constraint and crash the deriver — or be
// silently rejected, depending on the writer's onConflict clause. The
// enum value was dead weight that advertised storage support the schema
// no longer permits.
//
// v0.4.21 removes the dead enum value. This test guards against re-
// introduction: every kind enumerated MUST be compatible with company_id
// NOT NULL. The list below is the union of (a) the kinds we actually
// emit and (b) any kind whose evidence is unambiguously per-company.
// A future kind that doesn't fit that invariant must motivate either
// making the column nullable (would re-open audit-#3's PK collision
// class) or representing the kind in a separate table.

const PER_COMPANY_KINDS = new Set([
  "shared_employer_overlap",
  "shared_employer_currently",
  "shared_employer_no_overlap",
]);

describe("derived_edges.kind enum vs company_id NOT NULL invariant (review-#9)", () => {
  // Drizzle stores the enum on the column config. The runtime carries a
  // small object describing the column shape.
  const kindColumn = schema.derivedEdges.kind;

  test("every enum member is a per-company kind", () => {
    // Pull the enum list off the drizzle column config. The shape is
    // sqlite-text-enum at runtime; the public surface is the column's
    // `enumValues` array.
    const enumValues =
      (kindColumn as unknown as { enumValues?: readonly string[] }).enumValues ?? [];
    expect(enumValues.length).toBeGreaterThan(0);
    for (const v of enumValues) {
      expect(PER_COMPANY_KINDS.has(v)).toBe(true);
    }
  });

  test("connection_date_cluster is NOT in the enum (would violate NOT NULL company_id)", () => {
    const enumValues =
      (kindColumn as unknown as { enumValues?: readonly string[] }).enumValues ?? [];
    expect(enumValues).not.toContain("connection_date_cluster");
  });
});
