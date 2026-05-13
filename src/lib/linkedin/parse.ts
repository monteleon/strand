import JSZip from "jszip";

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

export type ParsedExport = {
  profile: LinkedInProfile;
  connections: LinkedInConnection[];
  positions: LinkedInPosition[];
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

function parsePositions(text: string): LinkedInPosition[] {
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
      current: !endRaw,
    };
  });
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
  return {
    profile: parseProfile(profileCsv),
    connections: parseConnections(connectionsCsv),
    positions: parsePositions(positionsCsv),
  };
}
