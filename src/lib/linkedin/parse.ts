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
//
// v0.4.15 (review-#3): rows with no Started On are dropped at parse, not
// persisted with current=false. positionIdFromParts hashes
// `${personId}|${companyId}|${startDate ?? "?"}|${title ?? "?"}` so two
// undated rows at the same (person, company, title) hash identically;
// post-v0.4.6 writePositions UPSERTs on conflict, which silently merges
// two distinct positions into one by overwriting endDate/current. The
// v0.4.3 current-flag fix was orthogonal — it kept the position out of
// the bothCurrent pool but did nothing about the hash collision.
// Dropping at parse eliminates the class: no insert, no UPSERT, no merge.
// Positions without a start date also can't participate in overlap math,
// so they contribute zero signal to the derived-edges graph.
export function parsePositions(text: string): LinkedInPosition[] {
  const { headers, rows } = readCsv(text, "Company Name");
  const positions: LinkedInPosition[] = [];
  for (const row of rows) {
    const companyName = col(headers, row, "Company Name").trim();
    const title = col(headers, row, "Title").trim();
    const description = col(headers, row, "Description").trim();
    const location = col(headers, row, "Location").trim();
    const startRaw = col(headers, row, "Started On").trim();
    const endRaw = col(headers, row, "Finished On").trim();
    const startDate = parsePositionDate(startRaw);
    const endDate = parsePositionDate(endRaw);
    // Drop undated rows. See note above the function.
    if (startDate === null) continue;
    positions.push({
      companyName,
      title: title || null,
      description: description || null,
      location: location || null,
      startDate,
      endDate,
      // "Current" means start is known AND no finish. With startDate
      // guaranteed non-null by the drop above, this collapses to !endRaw,
      // but kept explicit so the invariant is readable.
      current: Boolean(startRaw) && !endRaw,
    });
  }
  return positions;
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

// Total decompressed budget across all entries. The route already caps the
// *compressed* upload at 50 MB, but DEFLATE routinely hits 1000:1 on
// repetitive data — a 50 MB zip of zeros expands to ~50 GB and OOMs the
// worker before any per-file guard fires. JSZip reads uncompressed sizes from
// the central directory at loadAsync (no decompression yet), so we can reject
// a bomb before materialising a single byte. 200 MB leaves generous headroom
// for the heaviest real export (messages.csv can reach tens of MB) while
// making an expansion attack impossible.
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

// `_data.uncompressedSize` is populated from the zip central directory by
// loadAsync — it is JSZip-internal but stable across the 3.x line and is the
// only pre-decompression size signal available. Guarded read so a shape change
// degrades to a thrown error, never a silent bypass.
function declaredUncompressedSize(file: JSZip.JSZipObject): number {
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })
    ._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size >= 0
    ? size
    : Number.POSITIVE_INFINITY;
}

function assertNoZipBomb(zip: JSZip): void {
  let total = 0;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    total += declaredUncompressedSize(entry);
    if (total > MAX_DECOMPRESSED_BYTES) {
      throw new Error(
        `Export decompresses to more than ${MAX_DECOMPRESSED_BYTES} bytes; refusing to expand (possible zip bomb).`,
      );
    }
  }
}

export async function parseLinkedInExport(zipBytes: ArrayBuffer | Uint8Array | Buffer): Promise<ParsedExport> {
  const zip = await JSZip.loadAsync(zipBytes);
  // Reject decompression bombs before any entry is expanded into memory.
  assertNoZipBomb(zip);
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
