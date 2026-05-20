import { createHash } from "node:crypto";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { parseLinkedInExport, type ParsedExport } from "./parse";
import { deriveSharedEmployerEdges } from "@/lib/derived/edges";

export type IngestMessageStats = {
  parsed: number;
  expanded: number;
  skipped_no_url: number;
  skipped_no_date: number;
  skipped_no_person: number;
  inserted: number;
};

export type IngestResult = {
  batchId: string;
  duplicate: boolean;
  counts: {
    people: number;
    companies: number;
    positions: number;
    connections: number;
    messages: number;
  };
  // v0.3.0-A: present on a fresh ingest that included messages.csv. Omitted
  // on duplicate-shortcut returns and on Basic exports (no messages.csv in zip).
  messageStats?: IngestMessageStats;
};

const sha1Hex = (s: string) =>
  createHash("sha1").update(s).digest("hex");

const sha256Hex = (bytes: Buffer | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Lowercase, strip diacritics, collapse whitespace — gives a stable dedup key
// for company names. "PwC España" and "Pwc Espana" both normalise to "pwc espana".
function normaliseCompany(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const personIdFromUrl = (tenantId: string, linkedinUrl: string) =>
  sha1Hex(`${tenantId}|url|${linkedinUrl}`);

const ownerPersonId = (tenantId: string, fullName: string) =>
  sha1Hex(`${tenantId}|owner|${fullName}`);

const companyIdFromName = (tenantId: string, normalized: string) =>
  sha1Hex(`${tenantId}|company|${normalized}`);

const positionIdFromParts = (
  personId: string,
  companyId: string,
  startDate: string | null,
  title: string | null,
) => sha1Hex(`${personId}|${companyId}|${startDate ?? "?"}|${title ?? "?"}`);

export async function ingestLinkedInExport(
  zipBytes: Buffer,
  filename: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<IngestResult> {
  const sha256 = sha256Hex(zipBytes);

  // ISC-16: same .zip → no-op. Existing batch returned, no further writes.
  const existingBatch = await db
    .select()
    .from(schema.exportBatches)
    .where(eq(schema.exportBatches.sha256, sha256))
    .limit(1);
  if (existingBatch.length > 0) {
    const batch = existingBatch[0];
    const counts = await readTenantCounts(tenantId);
    return { batchId: batch.id, duplicate: true, counts };
  }

  const parsed = await parseLinkedInExport(zipBytes);
  const batchId = crypto.randomUUID();
  const now = new Date();

  // ISC-14: tenant exists. ingest must not crash if migrate hasn't run yet,
  // but in normal operation `bun run db:migrate` has already created 'local'.
  await db
    .insert(schema.tenants)
    .values({ id: tenantId, createdAt: now })
    .onConflictDoNothing();

  // ISC-15: batch row written. ISC-37: bytes never leave memory.
  await db.insert(schema.exportBatches).values({
    id: batchId,
    tenantId,
    source: "linkedin",
    uploadedAt: now,
    filename,
    sha256,
  });

  await writeOwner(parsed, tenantId, batchId, now);
  // v0.3.0-A: Profile.csv has no URL column; the owner's profile URL is
  // recovered from messages.csv (FROM == owner.fullName → SENDER URL) and
  // backfilled here so subsequent message resolution can use a single URL→id
  // path. Safe no-op when messages.csv is missing or owner sent no messages.
  await backfillOwnerLinkedinUrl(parsed, tenantId);
  await writeCompanies(parsed, tenantId);
  await writePeople(parsed, tenantId, batchId, now);
  await writeConnections(parsed, tenantId, now);
  await writePositions(parsed, tenantId);
  await writeSynthesisedConnectionPositions(parsed, tenantId);

  // Derive shared-employer edges from the fresh positions. Idempotent
  // (clear-then-rebuild) so cheap on every ingest. ISC-90.
  await deriveSharedEmployerEdges(tenantId, now);

  // v0.3.0-A: ingest messages last — depends on owner backfill + writePeople
  // having populated all 1st-degree person rows.
  const messageStats = await writeMessages(parsed, tenantId);

  const counts = await readTenantCounts(tenantId);
  return { batchId, duplicate: false, counts, messageStats };
}

async function writeOwner(
  parsed: ParsedExport,
  tenantId: string,
  batchId: string,
  now: Date,
) {
  const id = ownerPersonId(tenantId, parsed.profile.fullName);
  await db
    .insert(schema.people)
    .values({
      id,
      tenantId,
      fullName: parsed.profile.fullName,
      headline: parsed.profile.headline,
      email: null,
      linkedinUrl: null,
      sourceBatchId: batchId,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoNothing();

  // ISC-17: tenants.owner_person_id set
  await db
    .update(schema.tenants)
    .set({ ownerPersonId: id })
    .where(eq(schema.tenants.id, tenantId));
}

// Treat placeholders like "---", "n/a", "—" as missing rather than companies.
function isPlaceholderCompany(normalized: string): boolean {
  return !/[a-z0-9]/.test(normalized);
}

async function writeCompanies(parsed: ParsedExport, tenantId: string) {
  // Union of companies from positions + connections.company text.
  const names = new Set<string>();
  for (const p of parsed.positions) {
    if (p.companyName.trim()) names.add(p.companyName.trim());
  }
  for (const c of parsed.connections) {
    if (c.company && c.company.trim()) names.add(c.company.trim());
  }
  for (const raw of names) {
    const normalized = normaliseCompany(raw);
    if (!normalized || isPlaceholderCompany(normalized)) continue;
    await db
      .insert(schema.companies)
      .values({
        id: companyIdFromName(tenantId, normalized),
        tenantId,
        name: raw,
        normalizedName: normalized,
      })
      .onConflictDoNothing();
  }
}

async function writePeople(
  parsed: ParsedExport,
  tenantId: string,
  batchId: string,
  now: Date,
) {
  for (const c of parsed.connections) {
    if (!c.linkedinUrl) continue; // no URL → cannot dedup; skip rather than corrupt
    const id = personIdFromUrl(tenantId, c.linkedinUrl);
    await db
      .insert(schema.people)
      .values({
        id,
        tenantId,
        fullName: c.fullName || `${c.firstName} ${c.lastName}`.trim(),
        headline: c.position,
        email: c.email,
        linkedinUrl: c.linkedinUrl,
        sourceBatchId: batchId,
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoNothing();
  }
}

async function writeConnections(parsed: ParsedExport, tenantId: string, now: Date) {
  const tenantRow = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const ownerId = tenantRow[0]?.ownerPersonId;
  if (!ownerId) {
    throw new Error("Ingest invariant broken: owner_person_id is null");
  }
  for (const c of parsed.connections) {
    if (!c.linkedinUrl) continue;
    const toId = personIdFromUrl(tenantId, c.linkedinUrl);
    if (toId === ownerId) continue; // ISC-38: owner never appears as to_person_id
    await db
      .insert(schema.connections)
      .values({
        tenantId,
        fromPersonId: ownerId,
        toPersonId: toId,
        source: "linkedin",
        connectedAt: c.connectedAt,
      })
      .onConflictDoNothing();
  }
}

async function writePositions(parsed: ParsedExport, tenantId: string) {
  const tenantRow = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const ownerId = tenantRow[0]?.ownerPersonId;
  if (!ownerId) return;
  for (const p of parsed.positions) {
    const normalized = normaliseCompany(p.companyName);
    if (!normalized || isPlaceholderCompany(normalized)) continue;
    const companyId = companyIdFromName(tenantId, normalized);
    const positionId = positionIdFromParts(ownerId, companyId, p.startDate, p.title);
    await db
      .insert(schema.positions)
      .values({
        id: positionId,
        tenantId,
        personId: ownerId,
        companyId,
        title: p.title,
        startDate: p.startDate,
        endDate: p.endDate,
        current: p.current,
        origin: "declared",
      })
      .onConflictDoNothing();
  }
}

// W4: synthesise a positions row for every connection whose Connections.csv row
// has a non-empty Company text. We know they work there *today* but never had
// their dates — so start/end stay null and current=true. The derived-edges
// pass treats null-date positions as "ongoing today" so a synthesised pair at
// the same company overlaps now → 0-month overlap → confidence 0.4. Real
// overlap (≥1mo) only emerges between the owner's *declared* positions and
// connections' synthesised ones — exactly the high-value signal.
export async function writeSynthesisedConnectionPositions(
  parsed: ParsedExport,
  tenantId: string,
) {
  for (const c of parsed.connections) {
    if (!c.linkedinUrl) continue;
    if (!c.company || !c.company.trim()) continue;
    const normalized = normaliseCompany(c.company);
    if (!normalized || isPlaceholderCompany(normalized)) continue;
    const personId = personIdFromUrl(tenantId, c.linkedinUrl);
    const companyId = companyIdFromName(tenantId, normalized);
    const title = c.position && c.position.trim() ? c.position.trim() : null;
    const positionId = positionIdFromParts(personId, companyId, null, title);
    await db
      .insert(schema.positions)
      .values({
        id: positionId,
        tenantId,
        personId,
        companyId,
        title,
        startDate: null,
        endDate: null,
        current: true,
        origin: "synthesised",
      })
      .onConflictDoNothing();
  }
}

async function readTenantCounts(tenantId: string) {
  const [people, companies, positions, connections, messages] = await Promise.all([
    db.$count(schema.people, eq(schema.people.tenantId, tenantId)),
    db.$count(schema.companies, eq(schema.companies.tenantId, tenantId)),
    db.$count(schema.positions, eq(schema.positions.tenantId, tenantId)),
    db.$count(schema.connections, eq(schema.connections.tenantId, tenantId)),
    db.$count(schema.messages, eq(schema.messages.tenantId, tenantId)),
  ]);
  return { people, companies, positions, connections, messages };
}

// Backfill the owner's linkedin_url from messages.csv detection. Writes only
// when the parser successfully inferred the URL (FROM == owner.fullName).
async function backfillOwnerLinkedinUrl(parsed: ParsedExport, tenantId: string) {
  if (!parsed.ownerProfileUrl) return;
  const id = ownerPersonId(tenantId, parsed.profile.fullName);
  await db
    .update(schema.people)
    .set({ linkedinUrl: parsed.ownerProfileUrl })
    .where(eq(schema.people.id, id));
}

// v0.3.0-A: ingest messages.csv into the messages table.
//
// Resolution:
//   sender URL == owner URL → ownerPersonId
//   otherwise → personIdFromUrl(tenantId, url) IF that ID exists in `people`
//
// Skip reasons:
//   no_person  — sender or recipient URL doesn't map to any people row.
//                Captures InMail from non-connections, messages from deleted
//                accounts, and (until owner URL is detected) the owner's own
//                messages on a tenant that has never had Profile.csv URL.
//   self-DM    — fromId === toId after resolution. Dropped silently (not a
//                meaningful relationship signal).
//
// Idempotency: deterministic message `id` from (tenantId, conversationId,
// sentAtEpoch, fromPersonId, toPersonId) + ON CONFLICT DO NOTHING. Re-ingest
// of the same archive bytes hits the existingBatch shortcut earlier and never
// reaches this function; re-ingest of a DIFFERENT archive that overlaps still
// converges on the same row IDs.
async function writeMessages(
  parsed: ParsedExport,
  tenantId: string,
): Promise<IngestMessageStats> {
  const base = {
    ...parsed.messagesParseStats,
    skipped_no_person: 0,
    inserted: 0,
  };
  if (parsed.messages.length === 0) return base;

  const ownerId = ownerPersonId(tenantId, parsed.profile.fullName);
  const ownerUrl = parsed.ownerProfileUrl;

  // Pre-fetch the tenant's valid people IDs once — O(N) lookup instead of
  // O(N×M) SELECT-per-message.
  const peopleRows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(eq(schema.people.tenantId, tenantId));
  const validPeopleIds = new Set<string>();
  for (const r of peopleRows) validPeopleIds.add(r.id);

  const resolve = (url: string): string | null => {
    if (ownerUrl && url === ownerUrl) return ownerId;
    const id = personIdFromUrl(tenantId, url);
    return validPeopleIds.has(id) ? id : null;
  };

  type MessageRow = {
    id: string;
    tenantId: string;
    fromPersonId: string;
    toPersonId: string;
    sentAt: Date;
    direction: "sent" | "received";
  };

  const batch: MessageRow[] = [];
  let skipped_no_person = 0;
  for (const m of parsed.messages) {
    const fromId = resolve(m.senderProfileUrl);
    const toId = resolve(m.recipientProfileUrl);
    if (!fromId || !toId) {
      skipped_no_person += 1;
      continue;
    }
    if (fromId === toId) continue;
    const direction: "sent" | "received" = fromId === ownerId ? "sent" : "received";
    // contentHash tiebreaks same-second same-pair messages — LinkedIn's DATE
    // column has whole-second resolution, so rapid-fire bursts can share an
    // epoch and otherwise hash to identical IDs (Advisor catch, 2026-05-20).
    const id = sha1Hex(
      `${tenantId}|msg|${m.conversationId}|${m.sentAtEpoch}|${fromId}|${toId}|${m.contentHash}`,
    );
    batch.push({
      id,
      tenantId,
      fromPersonId: fromId,
      toPersonId: toId,
      sentAt: new Date(m.sentAtEpoch * 1000),
      direction,
    });
  }

  // Track real-DB delta so re-ingest of overlapping archives reports
  // truthful "inserted" counts (DO NOTHING conflicts don't count).
  const beforeCount = await db.$count(
    schema.messages,
    eq(schema.messages.tenantId, tenantId),
  );

  // Batched insert. SQLite via libsql tolerates a few hundred VALUES rows
  // per statement; 200 keeps the parameter count well under any practical
  // limit and minimises round-trips vs the per-row pattern used elsewhere
  // in this ingest.
  const CHUNK = 200;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    await db.insert(schema.messages).values(slice).onConflictDoNothing();
  }

  const afterCount = await db.$count(
    schema.messages,
    eq(schema.messages.tenantId, tenantId),
  );

  return {
    ...parsed.messagesParseStats,
    skipped_no_person,
    inserted: afterCount - beforeCount,
  };
}
