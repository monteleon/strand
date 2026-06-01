import JSZip from "jszip";
import { createHash } from "node:crypto";

const shortContentHash = (s: string) =>
  createHash("sha1").update(s).digest("hex").slice(0, 8);

export type LinkedInConnection = {
  firstName: string;
  lastName: string;
  fullName: string;
  linkedinUrl: string | null;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedAt: string | null; // YYYY-MM-DD
};

export type LinkedInPosition = {
  companyName: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startDate: string | null; // YYYY-MM-01
  endDate: string | null; // YYYY-MM-01, null = current
  current: boolean;
};

export type LinkedInProfile = {
  firstName: string;
  lastName: string;
  fullName: string;
  headline: string | null;
  industry: string | null;
  geoLocation: string | null;
};

export type LinkedInMessage = {
  conversationId: string;
  sentAtEpoch: number;          // seconds since epoch (UTC)
  senderProfileUrl: string;     // canonicalised (trim only — parity with Connections.csv)
  recipientProfileUrl: string;  // post-group-expansion: one record per (sender, recipient) pair
  folder: string;               // INBOX / ARCHIVE / etc.
  // Short content hash — sha1(CONTENT)[:8]. NOT stored in the DB; consumed
  // only as a tiebreaker in the deterministic message ID so rapid-fire
  // same-second-same-pair messages (LinkedIn's DATE column is whole-second
  // resolution) do not collide. The CONTENT body itself never leaves the
  // parser — only its hash.
  contentHash: string;
};

export type MessagesParseStats = {
  parsed: number;          // raw CSV record count (post-quoting, pre-expansion)
  expanded: number;        // post-group-expansion (sender, recipient) pair count
  skipped_no_url: number;  // record-level guard: sender or all recipients missing
  skipped_no_date: number; // DATE column unparseable
};

export type ParsedExport = {
  profile: LinkedInProfile;
  connections: LinkedInConnection[];
  positions: LinkedInPosition[];
  // v0.3.0-A: messages.csv is in the Complete export only; Basic ships an empty list.
  messages: LinkedInMessage[];
  // Owner's profile URL inferred from messages.csv (FROM == owner.fullName).
  // Null when messages.csv is missing or the owner has sent no messages in this archive.
  ownerProfileUrl: string | null;
  messagesParseStats: MessagesParseStats;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// "06 May 2026" → "2026-05-06"
export function parseConnectionDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

// "2026-05-12 12:16:17 UTC" → epoch seconds. Empty / unparseable → null.
export function parseMessageDate(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

// "Jul 2023" → "2023-07-01"; empty → null
export function parsePositionDate(s: string): string | null {
  if (!s || !s.trim()) return null;
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[2]}-${mm}-01`;
}

// Strip UTF-8 BOM and split into logical CSV rows, respecting quoted newlines.
function* iterRows(text: string): Generator<string[]> {
  const src = text.replace(/^﻿/, "");
  let field = "";
  let row: string[] = [];
  let inQuote = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (inQuote) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuote = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuote = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" && src[i + 1] === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
      i += 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      yield row;
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function readCsv(text: string, headerKey: string): { headers: string[]; rows: string[][] } {
  const all = Array.from(iterRows(text));
  // LinkedIn ships a multi-line "Notes" preamble before the real header in Connections.csv.
  // Scan rows until we find the one starting with the expected first column name.
  let headerIdx = -1;
  for (let i = 0; i < all.length; i++) {
    const first = (all[i][0] ?? "").replace(/^﻿/, "").trim();
    if (first === headerKey) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(`CSV header row starting with "${headerKey}" not found`);
  }
  const headers = all[headerIdx].map((h) => h.replace(/^﻿/, "").trim());
  const rows = all
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c.trim() !== ""));
  return { headers, rows };
}

function col(headers: string[], row: string[], name: string): string {
  const i = headers.indexOf(name);
  if (i === -1) return "";
  return row[i] ?? "";
}

function parseConnections(text: string): LinkedInConnection[] {
  const { headers, rows } = readCsv(text, "First Name");
  const out: LinkedInConnection[] = [];
  for (const row of rows) {
    const firstName = col(headers, row, "First Name").trim();
    const lastName = col(headers, row, "Last Name").trim();
    const url = col(headers, row, "URL").trim();
    // Skip phantom rows: every real connection has at least a name or a URL.
    // Trailing blank CSV rows (`,,,,,,`) survive the row-level filter but
    // carry no identifying info.
    if (!firstName && !lastName && !url) continue;
    const email = col(headers, row, "Email Address").trim();
    const company = col(headers, row, "Company").trim();
    const position = col(headers, row, "Position").trim();
    const connectedRaw = col(headers, row, "Connected On").trim();
    out.push({
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      linkedinUrl: url || null,
      email: email || null,
      company: company || null,
      position: position || null,
      connectedAt: connectedRaw ? parseConnectionDate(connectedRaw) : null,
    });
  }
  return out;
}

// Exported for unit testing — runtime ingest path goes through
// parseLinkedInExport, which is the only other caller.
export function parsePositions(text: string): LinkedInPosition[] {
  const { headers, rows } = readCsv(text, "Company Name");
  return rows.map((row) => {
    const companyName = col(headers, row, "Company Name").trim();
    const title = col(headers, row, "Title").trim();
    const description = col(headers, row, "Description").trim();
    const location = col(headers, row, "Location").trim();
    const startRaw = col(headers, row, "Started On").trim();
    const endRaw = col(headers, row, "Finished On").trim();
    const startDate = parsePositionDate(startRaw);
    const endDate = parsePositionDate(endRaw);
    return {
      companyName,
      title: title || null,
      description: description || null,
      location: location || null,
      startDate,
      endDate,
      // v0.4.3: a position is "current" only when there's a known start AND no
      // finish. Pre-fix `current: !endRaw` flipped to true for undated rows
      // (e.g. a Volunteer entry with title + description but neither Started
      // On nor Finished On) — those rows then got persisted with current=true
      // and joined the derived "currently together" pool, inflating
      // shared_employer_currently confidence (0.5 → 0.7 when paired with a
      // declared current position at the same company). "Current since when?"
      // is unanswerable without a start date, so undated rows are now
      // current=false.
      current: Boolean(startRaw) && !endRaw,
    };
  });
}

// Canonicalise a LinkedIn profile URL for join-key parity with people.linkedin_url.
// LinkedIn ships URLs identically across Connections.csv and messages.csv, so
// .trim() alone is sufficient — no scheme/locale normalisation needed.
function canonicaliseProfileUrl(s: string): string {
  return s.trim();
}

// Parse messages.csv. Returns expanded (sender, recipient) records, inferred
// owner profile URL, and a stats breakdown. Group-conversation rows expand
// into N records (one per recipient). Self-DMs are dropped post-expansion.
// Exported for unit testing — runtime ingest path goes through parseLinkedInExport.
export function parseMessages(
  text: string,
  ownerFullName: string,
): { messages: LinkedInMessage[]; ownerProfileUrl: string | null; stats: MessagesParseStats } {
  const { headers, rows } = readCsv(text, "CONVERSATION ID");
  const out: LinkedInMessage[] = [];
  let ownerProfileUrl: string | null = null;
  let parsed = 0;
  let expanded = 0;
  let skipped_no_url = 0;
  let skipped_no_date = 0;
  for (const row of rows) {
    parsed += 1;
    const conversationId = col(headers, row, "CONVERSATION ID").trim();
    const fromName = col(headers, row, "FROM").trim();
    const senderUrl = canonicaliseProfileUrl(col(headers, row, "SENDER PROFILE URL"));
    // RECIPIENT PROFILE URLS for group messages: comma-separated inside the
    // quoted CSV cell. After CSV-level parsing the cell is a single string;
    // we split on `,` to expand into individual recipients.
    const recipientField = col(headers, row, "RECIPIENT PROFILE URLS");
    const recipientUrls = recipientField
      .split(",")
      .map((u) => canonicaliseProfileUrl(u))
      .filter((u) => u !== "");
    const sentAtEpoch = parseMessageDate(col(headers, row, "DATE"));
    const folder = col(headers, row, "FOLDER").trim();
    const content = col(headers, row, "CONTENT");
    const contentHash = shortContentHash(content);

    if (sentAtEpoch === null) {
      skipped_no_date += 1;
      continue;
    }
    // Record-level guard (feedback memory 2026-05-13): drop messages that
    // carry neither a sender URL nor any recipient URL after canonicalisation.
    if (!senderUrl || recipientUrls.length === 0) {
      skipped_no_url += 1;
      continue;
    }
    // Owner detection: first row where FROM display name matches the
    // owner's full name from Profile.csv → the SENDER URL is the owner's URL.
    if (!ownerProfileUrl && fromName && fromName === ownerFullName) {
      ownerProfileUrl = senderUrl;
    }
    for (const recipientUrl of recipientUrls) {
      if (recipientUrl === senderUrl) continue; // self-DM artefacts
      out.push({
        conversationId,
        sentAtEpoch,
        senderProfileUrl: senderUrl,
        recipientProfileUrl: recipientUrl,
        folder,
        contentHash,
      });
      expanded += 1;
    }
  }
  return {
    messages: out,
    ownerProfileUrl,
    stats: { parsed, expanded, skipped_no_url, skipped_no_date },
  };
}

function parseProfile(text: string): LinkedInProfile {
  const { headers, rows } = readCsv(text, "First Name");
  if (rows.length !== 1) {
    throw new Error(
      `Profile.csv expected exactly 1 row (the owner), found ${rows.length}`,
    );
  }
  const row = rows[0];
  const firstName = col(headers, row, "First Name").trim();
  const lastName = col(headers, row, "Last Name").trim();
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" "),
    headline: col(headers, row, "Headline").trim() || null,
    industry: col(headers, row, "Industry").trim() || null,
    geoLocation: col(headers, row, "Geo Location").trim() || null,
  };
}

async function readZipFile(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) {
    throw new Error(`Required file missing from export: ${name}`);
  }
  return file.async("string");
}

export async function parseLinkedInExport(zipBytes: ArrayBuffer | Uint8Array | Buffer): Promise<ParsedExport> {
  const zip = await JSZip.loadAsync(zipBytes);
  const [profileCsv, connectionsCsv, positionsCsv] = await Promise.all([
    readZipFile(zip, "Profile.csv"),
    readZipFile(zip, "Connections.csv"),
    readZipFile(zip, "Positions.csv"),
  ]);
  const profile = parseProfile(profileCsv);
  const connections = parseConnections(connectionsCsv);
  const positions = parsePositions(positionsCsv);

  // messages.csv only ships in the Complete export. Basic users get an empty
  // messages list with parse stats zeroed — not an error.
  let messages: LinkedInMessage[] = [];
  let ownerProfileUrl: string | null = null;
  let messagesParseStats: MessagesParseStats = {
    parsed: 0,
    expanded: 0,
    skipped_no_url: 0,
    skipped_no_date: 0,
  };
  const messagesFile = zip.file("messages.csv");
  if (messagesFile) {
    const messagesCsv = await messagesFile.async("string");
    const r = parseMessages(messagesCsv, profile.fullName);
    messages = r.messages;
    ownerProfileUrl = r.ownerProfileUrl;
    messagesParseStats = r.stats;
  }

  return {
    profile,
    connections,
    positions,
    messages,
    ownerProfileUrl,
    messagesParseStats,
  };
}
