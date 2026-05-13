import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseConnectionDate, parseLinkedInExport, parsePositionDate } from "./parse";

const REAL_EXPORT_PATH =
  "/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip";

describe("date parsers", () => {
  test("ISC-3: connection date '06 May 2026' → '2026-05-06'", () => {
    expect(parseConnectionDate("06 May 2026")).toBe("2026-05-06");
  });
  test("ISC-3: connection date '1 Jan 2020' → '2020-01-01'", () => {
    expect(parseConnectionDate("1 Jan 2020")).toBe("2020-01-01");
  });
  test("ISC-3: invalid connection date → null", () => {
    expect(parseConnectionDate("garbage")).toBeNull();
    expect(parseConnectionDate("")).toBeNull();
  });
  test("ISC-4: position date 'Jul 2023' → '2023-07-01'", () => {
    expect(parsePositionDate("Jul 2023")).toBe("2023-07-01");
  });
  test("ISC-5: empty position date → null (signals current)", () => {
    expect(parsePositionDate("")).toBeNull();
    expect(parsePositionDate("   ")).toBeNull();
  });
});

describe("real export round-trip", () => {
  test("ISC-1..10: parses Matt's real LinkedIn export", async () => {
    const bytes = await readFile(REAL_EXPORT_PATH);
    const parsed = await parseLinkedInExport(bytes);

    // ISC-10: Profile.csv has exactly 1 row (owner)
    expect(parsed.profile.firstName).toBe("Matt");
    expect(parsed.profile.lastName).toBe("Alexander");
    expect(parsed.profile.fullName).toBe("Matt Alexander");
    expect(parsed.profile.headline).toContain("PwC");

    // ISC-1, ISC-2: preamble skipped, BOM stripped, header found
    // ISC-6: rows with empty email parse without error
    // Real export has 1796 connections (trailing phantom rows filtered out).
    expect(parsed.connections.length).toBeGreaterThan(1500);
    expect(parsed.connections.length).toBeLessThan(2000);

    // ISC-9: linkedin_url present on EVERY surviving connection row (phantom
    // rows are filtered at parse). Every connection has a URL.
    const withUrl = parsed.connections.filter((c) => c.linkedinUrl !== null);
    expect(withUrl.length).toBe(parsed.connections.length);

    // ISC-7: non-ASCII names round-trip cleanly
    const hasAccented = parsed.connections.some((c) =>
      /[áéíóúñÁÉÍÓÚÑ]/.test(c.fullName),
    );
    expect(hasAccented).toBe(true);

    // ISC-3: connection dates parsed as YYYY-MM-DD
    const dated = parsed.connections.filter((c) => c.connectedAt !== null);
    expect(dated.length).toBeGreaterThan(parsed.connections.length * 0.9);
    expect(dated[0].connectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ISC-4, ISC-5, ISC-8: positions parsed with quoted-comma locations + current flag
    expect(parsed.positions.length).toBeGreaterThan(0);
    const currentPositions = parsed.positions.filter((p) => p.current);
    expect(currentPositions.length).toBeGreaterThanOrEqual(1);
    const withQuotedLocation = parsed.positions.find((p) =>
      (p.location ?? "").includes(", "),
    );
    expect(withQuotedLocation).toBeDefined();
    const pwc = parsed.positions.find((p) => p.companyName === "PwC España");
    expect(pwc).toBeDefined();
    expect(pwc!.startDate).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
