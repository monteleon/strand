import JSZip from "jszip";

// Synthetic LinkedIn data export — the test suite's default dataset.
//
// Every name, company, URL and message here is invented; nothing is derived
// from a real export (the repo is public). The output is deterministic: same
// bytes on every call, so ingest IDs and the duplicate-detection sha256 are
// stable across runs.
//
// The shape mirrors what parse.ts expects from a real Complete export —
// Profile.csv, Connections.csv (with LinkedIn's "Notes" preamble, a UTF-8
// BOM and CRLF line endings), Positions.csv and messages.csv — and plants
// the edge cases the query tests used to go hunting for in Matt's data:
//
//   * Northwind Analytics — 130 connections + the owner's current role.
//     Big enough that at-company pagination spans 3 pages (131 rows →
//     50/50/31) and graph caps of 50/100 actually truncate.
//   * Quietwater Labs — 5 connections nobody has ever messaged: the
//     all-zero-warmth reach target.
//   * Zoe Varga — top two-way correspondent (16 sent / 14 received), named
//     late in the alphabet so warmth sort and epistemic sort (name-ASC
//     tiebreak) pick different top-1 intermediaries.
//   * Yusuf Brandt — one-way inbound (22 received, 0 sent): mutuality 0.
//   * Same-second burst to Zoe (contentHash tiebreak), a group message, an
//     InMail from a non-connection, a dateless row, a URL-less row, a
//     self-DM, a URL-less connection, placeholder companies, a trailing
//     blank row, an undated owner position, accented names and quoted
//     commas/newlines.
//
// FIXTURE holds the hand-computed expected facts. They are literals on
// purpose — deriving them from the same spec that builds the CSVs would let
// a generator bug and an assertion bug cancel out.

export const FIXTURE = {
  owner: {
    firstName: "Robin",
    lastName: "Testwell",
    fullName: "Robin Testwell",
    url: "https://www.linkedin.com/in/synthetic-robin-testwell",
    headline: "Data Lead at Northwind Analytics",
  },
  bigCompany: "Northwind Analytics",
  bigCompanySearch: "northwind",
  quietCompany: "Quietwater Labs",
  topContact: { fullName: "Zoe Varga", sent: 16, received: 14 },
  oneWayContact: { fullName: "Yusuf Brandt", sent: 0, received: 22 },
  // Parse-level
  connectionsParsed: 167, // 166 with URL + 1 URL-less
  connectionsWithUrl: 166,
  positionsParsed: 2, // undated "Old Co" row dropped at parse
  messageRows: 70,
  messagesExpanded: 69,
  messagesSkippedNoDate: 1,
  messagesSkippedNoUrl: 1,
  // Ingest-level
  people: 167, // owner + 166
  companies: 5, // Northwind, Blue Harbor, Quietwater, Lumen, Cedar & Pine
  declaredPositions: 2,
  synthesisedPositions: 161, // 130 + 12 + 5 + 8 + 6
  connections: 166,
  messagesSkippedNoPerson: 1,
  messagesInserted: 68,
  messagesSent: 26,
  messagesReceived: 42,
} as const;

const CONNECTIONS_HEADER = [
  "First Name",
  "Last Name",
  "URL",
  "Email Address",
  "Company",
  "Position",
  "Connected On",
];

const MESSAGES_HEADER = [
  "CONVERSATION ID",
  "CONVERSATION TITLE",
  "FROM",
  "SENDER PROFILE URL",
  "TO",
  "RECIPIENT PROFILE URLS",
  "DATE",
  "SUBJECT",
  "CONTENT",
  "FOLDER",
];

type Person = {
  first: string;
  last: string;
  url: string;
  company: string;
  position: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function csvRow(cells: string[], eol = "\n"): string {
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",") + eol;
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function person(first: string, last: string, company: string, position: string, tag: string): Person {
  return {
    first,
    last,
    url: `https://www.linkedin.com/in/synthetic-${slug(first)}-${slug(last)}-${tag}`,
    company,
    position,
  };
}

const FILLER_FIRST = [
  "Aaron", "Bea", "Carlos", "Dana", "Elif", "Farah", "Goran", "Hana", "Ivo",
  "Jonas", "Kira", "Luca", "Maya", "Nils", "Olga", "Pavel", "Quinn", "Rosa",
  "Sven", "Tara", "Uma",
];
const FILLER_LAST = ["Abbott", "Berg", "Castro", "Dahl", "Ekberg", "Fontaine"];

function buildConnections(): { people: Person[]; extraRows: string[][] } {
  const people: Person[] = [];

  // Northwind Analytics — 4 named specials + 126 fillers = 130.
  people.push(person("Zoe", "Varga", "Northwind Analytics", "Analytics Engineer", "nw0"));
  people.push(person("Yusuf", "Brandt", "Northwind Analytics", "Head of Growth", "nw1"));
  people.push(person("Mira", "Holt", "Northwind Analytics", "Data Scientist", "nw2"));
  people.push(person("José", "Núñez", "Northwind Analytics", "BI Developer", "nw3"));
  for (let i = 0; i < FILLER_FIRST.length * FILLER_LAST.length; i++) {
    const first = FILLER_FIRST[i % FILLER_FIRST.length]!;
    const last = FILLER_LAST[Math.floor(i / FILLER_FIRST.length)]!;
    people.push(person(first, last, "Northwind Analytics", "Consultant", `nwf${i}`));
  }

  // Blue Harbor Bank — owner's past employer. 12 connections.
  people.push(person("Inés", "Álvarez", "Blue Harbor Bank", "Risk Manager", "bh0"));
  for (let i = 1; i < 12; i++) {
    people.push(person(FILLER_FIRST[i]!, "Harbor", "Blue Harbor Bank", "Analyst", `bh${i}`));
  }

  // Quietwater Labs — never messaged. 5 connections.
  for (let i = 0; i < 5; i++) {
    people.push(person(FILLER_FIRST[i + 3]!, "Stillman", "Quietwater Labs", "Researcher", `qw${i}`));
  }

  // Lumen Freight — 8 connections (3 of them receive the group message).
  for (let i = 0; i < 8; i++) {
    people.push(person(FILLER_FIRST[i + 6]!, "Lumen", "Lumen Freight", "Logistics Lead", `lf${i}`));
  }

  // Cedar & Pine Consulting — 6 connections; one title carries a quoted
  // comma and an embedded double quote to exercise CSV escaping.
  people.push(person("Theo", "Marsh", "Cedar & Pine Consulting", 'Partner, "Data & AI"', "cp0"));
  for (let i = 1; i < 6; i++) {
    people.push(person(FILLER_FIRST[i + 9]!, "Pine", "Cedar & Pine Consulting", "Manager", `cp${i}`));
  }

  // Placeholder companies — must never become `companies` rows.
  people.push(person("Pia", "Nowhere", "---", "Freelancer", "ph0"));
  people.push(person("Rui", "Nowhere", "n/a", "Student", "ph1"));

  // No company at all.
  for (let i = 0; i < 3; i++) {
    people.push(person(FILLER_FIRST[i + 12]!, "Freeman", "", "", `nc${i}`));
  }

  // URL-less connection (deleted / hidden profile) — parsed, never persisted.
  const extraRows = [["Hidden", "Member", "", "", "", "", "01 Jan 2020"]];
  return { people, extraRows };
}

function connectedOn(i: number): string {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = MONTHS[i % 12]!;
  const year = 2015 + (i % 10);
  return `${day} ${month} ${year}`;
}

function buildConnectionsCsv(people: Person[], extraRows: string[][]): string {
  const EOL = "\r\n";
  let out = "﻿";
  out += "Notes:" + EOL;
  out += csvRow(
    [
      "When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email",
    ],
    EOL,
  );
  out += EOL;
  out += CONNECTIONS_HEADER.join(",") + EOL;
  people.forEach((p, i) => {
    const email = i % 4 === 0 ? `${slug(p.first)}.${slug(p.last)}@example.invalid` : "";
    out += csvRow([p.first, p.last, p.url, email, p.company, p.position, connectedOn(i)], EOL);
  });
  for (const r of extraRows) out += csvRow(r, EOL);
  out += ",,,,,," + EOL; // trailing phantom row
  return out;
}

function buildProfileCsv(): string {
  const o = FIXTURE.owner;
  return (
    "First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n" +
    csvRow([o.firstName, o.lastName, "", "", "", o.headline, "Synthetic owner for tests.", "IT Services and IT Consulting", "", "Madrid, Community of Madrid, Spain", "", "", ""])
  );
}

function buildPositionsCsv(): string {
  return (
    "Company Name,Title,Description,Location,Started On,Finished On\n" +
    csvRow(["Northwind Analytics", "Data Lead", "Leads the BI platform team.", "Madrid, Community of Madrid, Spain", "Mar 2019", ""]) +
    csvRow(["Blue Harbor Bank", "BI Analyst", "", "Lisbon, Portugal", "Jan 2014", "Feb 2019"]) +
    csvRow(["Old Co", "Intern", "Undated — dropped at parse.", "", "", ""])
  );
}

function buildMessagesCsv(byName: Map<string, Person>): string {
  const o = FIXTURE.owner;
  const rows: string[] = [MESSAGES_HEADER.join(",") + "\n"];
  let tick = 0;
  // One message per day from 2023-01-02 09:00 UTC, in row order.
  const nextDate = () => {
    const d = new Date(Date.UTC(2023, 0, 2, 9, 0, 0) + tick * 86_400_000);
    tick += 1;
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  };
  const add = (conv: string, fromName: string, fromUrl: string, toName: string, toUrls: string, date: string, content: string) => {
    rows.push(csvRow([conv, "", fromName, fromUrl, toName, toUrls, date, "", content, "INBOX"]));
  };
  const p = (name: string) => {
    const hit = byName.get(name);
    if (!hit) throw new Error(`fixture: unknown person ${name}`);
    return hit;
  };
  const name = (x: Person) => `${x.first} ${x.last}`;

  // Zoe Varga — 16 sent / 14 received. Owner's first row (drives owner-URL
  // detection). The first two sent rows share a timestamp: the contentHash
  // tiebreak must keep both.
  const zoe = p("Zoe Varga");
  const burst = nextDate();
  add("conv-zoe", o.fullName, o.url, name(zoe), zoe.url, burst, "Morning! Quick one about the dashboard.");
  add("conv-zoe", o.fullName, o.url, name(zoe), zoe.url, burst, "Actually, two quick ones.");
  for (let i = 0; i < 14; i++) {
    add("conv-zoe", o.fullName, o.url, name(zoe), zoe.url, nextDate(), `Sent note ${i}`);
    add("conv-zoe", name(zoe), zoe.url, o.fullName, o.url, nextDate(), `Reply ${i}, with a comma`);
  }

  // Yusuf Brandt — 22 received, 0 sent (one-way, newsletter-style).
  const yusuf = p("Yusuf Brandt");
  for (let i = 0; i < 22; i++) {
    add("conv-yusuf", name(yusuf), yusuf.url, o.fullName, o.url, nextDate(), `Growth digest #${i}`);
  }

  // Mira Holt — 5 / 5, one body with a quoted newline and double quotes.
  const mira = p("Mira Holt");
  for (let i = 0; i < 5; i++) {
    add("conv-mira", o.fullName, o.url, name(mira), mira.url, nextDate(), i === 0 ? 'Line one\nLine "two"' : `Ping ${i}`);
    add("conv-mira", name(mira), mira.url, o.fullName, o.url, nextDate(), `Pong ${i}`);
  }

  // Inés Álvarez — 2 sent / 1 received.
  const ines = p("Inés Álvarez");
  add("conv-ines", o.fullName, o.url, name(ines), ines.url, nextDate(), "¿Café la semana que viene?");
  add("conv-ines", name(ines), ines.url, o.fullName, o.url, nextDate(), "¡Claro!");
  add("conv-ines", o.fullName, o.url, name(ines), ines.url, nextDate(), "Perfecto.");

  // Group message — one row, three recipients → three sent records.
  const group = [p("Goran Lumen"), p("Hana Lumen"), p("Ivo Lumen")];
  add(
    "conv-group",
    o.fullName,
    o.url,
    group.map(name).join(", "),
    group.map((g) => g.url).join(","),
    nextDate(),
    "Kick-off on Monday, everyone.",
  );

  // InMail from a non-connection — parses, then skipped_no_person at ingest.
  add("conv-inmail", "Stranger Recruiter", "https://www.linkedin.com/in/synthetic-stranger-recruiter", o.fullName, o.url, nextDate(), "Exciting opportunity!");

  // Dateless row → skipped_no_date.
  add("conv-broken", name(zoe), zoe.url, o.fullName, o.url, "", "No timestamp on this one.");

  // Sender URL missing → skipped_no_url.
  add("conv-broken", "LinkedIn Member", "", o.fullName, o.url, nextDate(), "Sender left LinkedIn.");

  // Self-DM artefact → dropped post-expansion (no stat).
  add("conv-self", o.fullName, o.url, o.fullName, o.url, nextDate(), "Note to self.");

  return rows.join("");
}

// Fixed entry timestamp so the zip bytes (and therefore the batch sha256)
// are identical on every call.
const ZIP_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

export async function buildSyntheticExport(
  options: { includeMessages?: boolean } = {},
): Promise<Buffer> {
  const includeMessages = options.includeMessages ?? true;
  const { people, extraRows } = buildConnections();
  const byName = new Map(people.map((p) => [`${p.first} ${p.last}`, p]));

  const zip = new JSZip();
  zip.file("Profile.csv", buildProfileCsv(), { date: ZIP_DATE });
  zip.file("Connections.csv", buildConnectionsCsv(people, extraRows), { date: ZIP_DATE });
  zip.file("Positions.csv", buildPositionsCsv(), { date: ZIP_DATE });
  if (includeMessages) {
    zip.file("messages.csv", buildMessagesCsv(byName), { date: ZIP_DATE });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
