// Read-side queries for messages. Kept in a separate module from
// manualEdges and derivedEdges (ISC-253 / ISC-265 anti-criteria): messages
// are a third epistemic category — observed communication events, not
// asserted facts or inferred relationships. Different epistemics →
// different code paths. Same isolation pattern as ISC-94 enforces between
// manual and derived edges.
import { sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db } from "@/lib/db";
import { getOwnerId } from "@/lib/queries/people";

export type MessageDirection = "sent" | "received";

export type MessageStats = {
  // sent = messages OWNER sent to this person.
  // received = messages this person sent to OWNER.
  // direction is owner-perspective, set at ingest by the owner-URL detection
  // path in v0.3.0-A (see ISC-234). Don't "normalise" this away — sent vs
  // received carries the owner's agency information.
  sent: number;
  received: number;
  total: number;
  firstAt: Date | null;
  lastAt: Date | null;
};

export type MessageThreadItem = {
  id: string;
  direction: MessageDirection;
  sentAt: Date;
};

const EMPTY_STATS: MessageStats = {
  sent: 0,
  received: 0,
  total: 0,
  firstAt: null,
  lastAt: null,
};

// ISC-242, ISC-243: per-person stats via single SQL round-trip.
// COALESCE protects against the empty-pair case where SUM returns NULL.
export async function getMessageStatsForPerson(
  personId: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<MessageStats> {
  const ownerId = await getOwnerId(tenantId);
  if (!ownerId) return EMPTY_STATS;

  const rows = await db.all<{
    sent: number;
    received: number;
    total: number;
    first_at: number | null;
    last_at: number | null;
  }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END), 0) AS received,
      COUNT(*) AS total,
      MIN(sent_at) AS first_at,
      MAX(sent_at) AS last_at
    FROM messages
    WHERE tenant_id = ${tenantId}
      AND (
        (from_person_id = ${ownerId} AND to_person_id = ${personId}) OR
        (from_person_id = ${personId} AND to_person_id = ${ownerId})
      )
  `);
  const r = rows[0];
  if (!r) return EMPTY_STATS;
  return {
    sent: Number(r.sent),
    received: Number(r.received),
    total: Number(r.total),
    firstAt: epochToDate(r.first_at),
    lastAt: epochToDate(r.last_at),
  };
}

// ISC-244: thread for a person, newest first. No content/subject in the
// return shape — we deliberately never persisted message bodies (only their
// sha1[:8] tiebreaker), so there is nothing to render beyond direction +
// timestamp. The page layer relies on this honest emptiness.
export async function listMessageThreadForPerson(
  personId: string,
  limit: number = 20,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<MessageThreadItem[]> {
  const ownerId = await getOwnerId(tenantId);
  if (!ownerId) return [];

  const rows = await db.all<{
    id: string;
    direction: MessageDirection;
    sent_at: number;
  }>(sql`
    SELECT id, direction, sent_at
    FROM messages
    WHERE tenant_id = ${tenantId}
      AND (
        (from_person_id = ${ownerId} AND to_person_id = ${personId}) OR
        (from_person_id = ${personId} AND to_person_id = ${ownerId})
      )
    ORDER BY sent_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    sentAt: new Date(Number(r.sent_at) * 1000),
  }));
}

// ISC-245: batch-load Map<personId, lastContact> for the /people list page.
// Single SQL round-trip with parameterised IN-clause via sql.join — no N+1.
// We use the pre-computed `direction` column (owner-perspective, set at
// ingest) so the "which side is the contact" CASE is direction-aware and the
// IN clause stays on a single column per branch (index-friendly).
export async function listLastContactByPeople(
  personIds: string[],
  tenantId: string = LOCAL_TENANT_ID,
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (personIds.length === 0) return result;

  const idList = sql.join(
    personIds.map((p) => sql`${p}`),
    sql`, `,
  );
  const rows = await db.all<{ other_id: string; last_at: number }>(sql`
    SELECT
      CASE WHEN direction = 'sent' THEN to_person_id ELSE from_person_id END AS other_id,
      MAX(sent_at) AS last_at
    FROM messages
    WHERE tenant_id = ${tenantId}
      AND (
        (direction = 'sent' AND to_person_id IN (${idList})) OR
        (direction = 'received' AND from_person_id IN (${idList}))
      )
    GROUP BY other_id
  `);
  for (const r of rows) {
    result.set(r.other_id, new Date(Number(r.last_at) * 1000));
  }
  return result;
}

// ISC-266 (Advisor 2026-05-20): tenant-wide ordered list of (personId,
// lastAt) for all people-with-messages. Lets the /people list module sort
// the global cohort by last-contact WITHOUT reaching into the messages
// TABLE from another module — preserves the third-epistemic-category
// boundary at the schema layer (not just the JS-import layer).
//
// Returned order: lastAt DESC. People with NO messages are absent from
// this list; the caller composes them after the trailing alphabetical
// segment to honour "NULLS LAST" semantics.
export async function listAllLastContactDesc(
  tenantId: string = LOCAL_TENANT_ID,
): Promise<Array<{ personId: string; lastAt: Date }>> {
  const rows = await db.all<{ other_id: string; last_at: number }>(sql`
    SELECT
      CASE WHEN direction = 'sent' THEN to_person_id ELSE from_person_id END AS other_id,
      MAX(sent_at) AS last_at
    FROM messages
    WHERE tenant_id = ${tenantId}
    GROUP BY other_id
    ORDER BY last_at DESC
  `);
  return rows.map((r) => ({
    personId: r.other_id,
    lastAt: new Date(Number(r.last_at) * 1000),
  }));
}

// Helper used by both queries above. SQLite stores sent_at as epoch seconds
// (drizzle's `mode: "timestamp"` writes seconds, not millis); the raw `sql`
// path bypasses drizzle's auto-conversion so we multiply explicitly.
function epochToDate(epoch: number | null): Date | null {
  if (epoch === null || epoch === undefined) return null;
  return new Date(Number(epoch) * 1000);
}

// YYYY-MM-DD formatter used by the UI surfaces. Matches the format used by
// `connected_at` (which is stored as text in that shape already), keeping the
// /people row layout visually consistent across the two date columns.
export function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
