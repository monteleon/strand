import { createHash } from "node:crypto";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { parseLinkedInExport, type ParsedExport } from "./parse";
import { deriveSharedEmployerEdges } from "@/lib/derived/edges";

export type IngestResult = {
  batchId: string;
  duplicate: boolean;
  counts: {
    people: number;
    companies: number;
    positions: number;
    connections: number;
  };
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
  await writeCompanies(parsed, tenantId);
  await writePeople(parsed, tenantId, batchId, now);
  await writeConnections(parsed, tenantId, now);
  await writePositions(parsed, tenantId);
  await writeSynthesisedConnectionPositions(parsed, tenantId);

  // Derive shared-employer edges from the fresh positions. Idempotent
  // (clear-then-rebuild) so cheap on every ingest. ISC-90.
  await deriveSharedEmployerEdges(tenantId, now);

  const counts = await readTenantCounts(tenantId);
  return { batchId, duplicate: false, counts };
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
  const [people, companies, positions, connections] = await Promise.all([
    db.$count(schema.people, eq(schema.people.tenantId, tenantId)),
    db.$count(schema.companies, eq(schema.companies.tenantId, tenantId)),
    db.$count(schema.positions, eq(schema.positions.tenantId, tenantId)),
    db.$count(schema.connections, eq(schema.connections.tenantId, tenantId)),
  ]);
  return { people, companies, positions, connections };
}
