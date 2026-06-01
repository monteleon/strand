import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  parseConnectionDate,
  parseLinkedInExport,
  parseMessageDate,
  parseMessages,
  parsePositionDate,
  parsePositions,
} from "./parse";

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

describe("v0.4.3: parsePositions — `current` requires startRaw, not just absent endRaw", () => {
  const HEADER = `"Company Name","Title","Description","Location","Started On","Finished On"`;
  const positionFromRow = (row: string) =>
    parsePositions(`${HEADER}\n${row}`)[0]!;

  test("declared current position (start, no end) → current=true", () => {
    const p = positionFromRow(`"Acme","Engineer","","","Jan 2024",""`);
    expect(p.current).toBe(true);
    expect(p.startDate).toBe("2024-01-01");
    expect(p.endDate).toBeNull();
  });

  test("declared past position (start and end) → current=false", () => {
    const p = positionFromRow(`"Acme","Engineer","","","Jan 2020","Dec 2023"`);
    expect(p.current).toBe(false);
    expect(p.startDate).toBe("2020-01-01");
    expect(p.endDate).toBe("2023-12-01");
  });

  test("the bug case — title + description but NO Started On AND NO Finished On → current=false (was true)", () => {
    const p = positionFromRow(
      `"Local Volunteers","Volunteer","Helped on Saturdays","",""`,
    );
    // Pre-fix: `current: !endRaw` ⇒ true (the bug). Post-fix:
    // `current: Boolean(startRaw) && !endRaw` ⇒ false.
    expect(p.current).toBe(false);
    expect(p.startDate).toBeNull();
    expect(p.endDate).toBeNull();
  });

  test("anomalous row — no start but has end → current=false (unchanged)", () => {
    const p = positionFromRow(`"Acme","Engineer","","","","Dec 2023"`);
    expect(p.current).toBe(false);
  });

  test("whitespace-only Started On is treated as absent → current=false", () => {
    const p = positionFromRow(`"Acme","Engineer","","","   ",""`);
    expect(p.current).toBe(false);
    expect(p.startDate).toBeNull();
  });
});

describe("v0.3.0-A: messages.csv parser", () => {
  const HEADER =
    `"CONVERSATION ID","CONVERSATION TITLE","FROM","SENDER PROFILE URL",` +
    `"TO","RECIPIENT PROFILE URLS","DATE","SUBJECT","CONTENT","FOLDER","ATTACHMENTS"`;

  test("ISC-228: parseMessageDate handles LinkedIn's 'YYYY-MM-DD HH:MM:SS UTC' format", () => {
    expect(parseMessageDate("2026-05-12 12:16:17 UTC")).toBe(
      Math.floor(Date.UTC(2026, 4, 12, 12, 16, 17) / 1000),
    );
  });

  test("ISC-228: parseMessageDate returns null on empty / malformed input", () => {
    expect(parseMessageDate("")).toBeNull();
    expect(parseMessageDate("   ")).toBeNull();
    expect(parseMessageDate("2026-05-12T12:16:17Z")).toBeNull();
    expect(parseMessageDate("garbage")).toBeNull();
  });

  test("ISC-227, ISC-230: parses a single 1:1 message — happy path", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-1","","Miguel","https://www.linkedin.com/in/miguel",` +
      `"Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"2026-04-18 08:18:17 UTC","","Ok, buen finde!","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].conversationId).toBe("conv-1");
    expect(r.messages[0].senderProfileUrl).toBe("https://www.linkedin.com/in/miguel");
    expect(r.messages[0].recipientProfileUrl).toBe(
      "https://www.linkedin.com/in/matt-pwc-bi",
    );
    expect(r.stats).toEqual({
      parsed: 1,
      expanded: 1,
      skipped_no_url: 0,
      skipped_no_date: 0,
    });
  });

  test("ISC-230: group conversation expands into one record per recipient", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-g","Group","Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"David, Rubén","https://www.linkedin.com/in/david,https://www.linkedin.com/in/ruben",` +
      `"2026-04-18 08:18:17 UTC","","hey","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(2);
    expect(r.messages.map((m) => m.recipientProfileUrl).sort()).toEqual([
      "https://www.linkedin.com/in/david",
      "https://www.linkedin.com/in/ruben",
    ]);
    expect(r.stats.parsed).toBe(1);
    expect(r.stats.expanded).toBe(2);
  });

  test("ISC-231: row with no recipient URL is skipped (record-level guard)", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-x","","Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Unknown","",` +
      `"2026-04-18 08:18:17 UTC","","","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(0);
    expect(r.stats.skipped_no_url).toBe(1);
    expect(r.stats.expanded).toBe(0);
  });

  test("ISC-228: row with unparseable date is skipped and counted", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-bad","","Miguel","https://www.linkedin.com/in/miguel",` +
      `"Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"not-a-date","","hi","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(0);
    expect(r.stats.skipped_no_date).toBe(1);
  });

  test("ISC-238: self-DM (sender URL == recipient URL) is dropped post-expansion", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-self","","Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"2026-04-18 08:18:17 UTC","","note","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(0);
    expect(r.stats.parsed).toBe(1);
    expect(r.stats.expanded).toBe(0);
  });

  test("owner profile URL is detected from first FROM == owner.fullName row", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-a","","Miguel","https://www.linkedin.com/in/miguel",` +
      `"Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"2026-04-18 08:18:17 UTC","","hi","INBOX",""\n` +
      `"conv-a","","Matt Alexander","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Miguel","https://www.linkedin.com/in/miguel",` +
      `"2026-04-18 08:19:17 UTC","","sup","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.ownerProfileUrl).toBe("https://www.linkedin.com/in/matt-pwc-bi");
    expect(r.messages.length).toBe(2);
  });

  test("ISC-235.1 (Advisor 2026-05-20): same-second same-pair messages get distinct contentHash → distinct IDs", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-burst","","Matt","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Miguel","https://www.linkedin.com/in/miguel",` +
      `"2026-04-18 08:18:17 UTC","","hey","INBOX",""\n` +
      `"conv-burst","","Matt","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Miguel","https://www.linkedin.com/in/miguel",` +
      `"2026-04-18 08:18:17 UTC","","hi","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(2);
    // Same (conversationId, sentAtEpoch, sender, recipient) but distinct
    // CONTENT → distinct contentHash → distinct deterministic IDs at ingest.
    expect(r.messages[0].contentHash).not.toBe(r.messages[1].contentHash);
  });

  test("ISC-239: multi-line CONTENT (quoted newline) does not break row parsing", () => {
    const csv =
      `${HEADER}\n` +
      `"conv-m","","Miguel","https://www.linkedin.com/in/miguel",` +
      `"Matt","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"2026-04-18 08:18:17 UTC","","line1\nline2\nline3","INBOX",""\n` +
      `"conv-m","","Matt","https://www.linkedin.com/in/matt-pwc-bi",` +
      `"Miguel","https://www.linkedin.com/in/miguel",` +
      `"2026-04-19 08:18:17 UTC","","reply","INBOX",""\n`;
    const r = parseMessages(csv, "Matt Alexander");
    expect(r.messages.length).toBe(2);
    expect(r.stats.parsed).toBe(2);
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
