import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  formatDateYMD,
  getMessageStatsForPerson,
  listAllLastContactDesc,
  listLastContactByPeople,
  listMessageThreadForPerson,
} from "./messages";

// These tests run against the real data/strand.db populated by v0.3.0-A
// against Matt's actual LinkedIn export — same pattern as parse.test.ts,
// which reads the real export bytes. Assertions are structural ("total > 0",
// "ordered desc", "map size matches input") rather than data-coupled, so
// they survive re-ingestion as long as the dataset still has any messages.

async function topContactByVolume(): Promise<{ id: string; total: number }> {
  const rows = await db.all<{ other_id: string; total: number }>(sql`
    SELECT
      CASE WHEN direction = 'sent' THEN to_person_id ELSE from_person_id END AS other_id,
      COUNT(*) AS total
    FROM messages
    WHERE tenant_id = 'local'
    GROUP BY other_id
    ORDER BY total DESC
    LIMIT 1
  `);
  if (rows.length === 0) {
    throw new Error("no messages in db — re-ingest the LinkedIn export first");
  }
  return { id: rows[0]!.other_id, total: Number(rows[0]!.total) };
}

describe("v0.3.0-B: messages queries", () => {
  test("ISC-242 + ISC-243: getMessageStatsForPerson — top contact has total ≥ 10 with both sent and received", async () => {
    const top = await topContactByVolume();
    const stats = await getMessageStatsForPerson(top.id);
    expect(stats.total).toBe(top.total);
    expect(stats.total).toBeGreaterThanOrEqual(10);
    expect(stats.sent + stats.received).toBe(stats.total);
    // ISC-261: a real two-way correspondent exists in the dataset
    expect(stats.sent).toBeGreaterThan(0);
    expect(stats.received).toBeGreaterThan(0);
    expect(stats.firstAt).not.toBeNull();
    expect(stats.lastAt).not.toBeNull();
    if (stats.firstAt && stats.lastAt) {
      // First ≤ last across the dataset
      expect(stats.firstAt.getTime()).toBeLessThanOrEqual(stats.lastAt.getTime());
    }
  });

  test("ISC-247: getMessageStatsForPerson — empty case returns zeros and null dates", async () => {
    const stats = await getMessageStatsForPerson("00000000-no-such-person");
    expect(stats.sent).toBe(0);
    expect(stats.received).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.firstAt).toBeNull();
    expect(stats.lastAt).toBeNull();
  });

  test("ISC-244: listMessageThreadForPerson — chronological order (newest first), limit honoured", async () => {
    const top = await topContactByVolume();
    const thread = await listMessageThreadForPerson(top.id, 5);
    expect(thread.length).toBeLessThanOrEqual(5);
    expect(thread.length).toBeGreaterThan(0);
    for (let i = 1; i < thread.length; i++) {
      expect(thread[i - 1]!.sentAt.getTime()).toBeGreaterThanOrEqual(
        thread[i]!.sentAt.getTime(),
      );
    }
    // No content/subject keys leaked
    const sample = thread[0]!;
    expect(Object.keys(sample).sort()).toEqual(
      ["direction", "id", "sentAt"].sort(),
    );
  });

  test("ISC-244: empty thread for non-existent person", async () => {
    const thread = await listMessageThreadForPerson("00000000-no-such-person");
    expect(thread).toEqual([]);
  });

  test("ISC-245: listLastContactByPeople — batch returns map keyed by person id, no N+1", async () => {
    // Pick a mixed batch: top contact (has messages) + non-existent (no messages).
    const top = await topContactByVolume();
    const batch = await listLastContactByPeople([
      top.id,
      "00000000-no-such-person",
    ]);
    expect(batch.size).toBe(1); // only the contact with messages gets a row
    expect(batch.get(top.id)).toBeInstanceOf(Date);
    expect(batch.get("00000000-no-such-person")).toBeUndefined();
  });

  test("ISC-245: listLastContactByPeople — empty input returns empty map (no SQL emitted)", async () => {
    const batch = await listLastContactByPeople([]);
    expect(batch.size).toBe(0);
  });

  test("ISC-245: lastContactAt matches MAX(sent_at) from stats for the same person", async () => {
    const top = await topContactByVolume();
    const stats = await getMessageStatsForPerson(top.id);
    const batch = await listLastContactByPeople([top.id]);
    const fromBatch = batch.get(top.id);
    expect(fromBatch).toBeInstanceOf(Date);
    if (stats.lastAt && fromBatch) {
      expect(fromBatch.getTime()).toBe(stats.lastAt.getTime());
    }
  });

  test("ISC-266: listAllLastContactDesc — ordered DESC across the whole tenant", async () => {
    const ordered = await listAllLastContactDesc();
    expect(ordered.length).toBeGreaterThan(0);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1]!.lastAt.getTime()).toBeGreaterThanOrEqual(
        ordered[i]!.lastAt.getTime(),
      );
    }
    // First entry's lastAt matches the dataset max
    const [maxRow] = await db.all<{ m: number }>(sql`
      SELECT MAX(sent_at) AS m FROM messages WHERE tenant_id = 'local'
    `);
    expect(ordered[0]!.lastAt.getTime()).toBe(Number(maxRow!.m) * 1000);
  });

  test("formatDateYMD: produces YYYY-MM-DD slice from Date", () => {
    expect(formatDateYMD(new Date("2026-05-20T15:39:18Z"))).toBe("2026-05-20");
    expect(formatDateYMD(new Date(Date.UTC(2018, 10, 12, 16, 25, 1)))).toBe(
      "2018-11-12",
    );
  });
});
