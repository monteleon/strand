#!/usr/bin/env bun
// One-shot repair for tenants that suffered the pre-v0.4.2 owner-rename
// orphaning bug. Pre-fix `writeOwner` hashed the owner's display name into
// their primary key, so a re-ingest after a LinkedIn rename inserted a SECOND
// owner row at a different id and flipped `tenants.ownerPersonId` to it.
// All existing connections.from_person_id / positions.person_id /
// manual_edges.person_a/b / messages.from/to_person_id stayed pointing at
// the dead old id → /people /graph /queries/reach silently returned
// owner-empty results until manual DB surgery.
//
// Detection: any people row id that appears in `connections.from_person_id`
// but is NOT the current `tenants.ownerPersonId` is a stranded former owner
// (connections.from_person_id is invariantly the owner per ISC-38).
//
// Repair (idempotent per owner): rewrite every FK reference from
// stranded_id → current_owner across connections, positions, manual_edges
// (with canonical-pair re-sort), and messages; drop stranded derived_edges
// and re-derive at the end; delete the stranded people row.
//
// Default mode is DRY-RUN. Pass --apply to actually mutate.
//
//   bun run scripts/repair-owner-orphans.ts          # report only
//   bun run scripts/repair-owner-orphans.ts --apply  # mutate

import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { deriveSharedEmployerEdges } from "@/lib/derived/edges";

type Counts = {
  connectionsFrom: number;
  positions: number;
  manualEdges: number;
  messagesFrom: number;
  messagesTo: number;
  derivedEdges: number;
};

type StrandedOwner = {
  oldId: string;
  oldName: string | null;
  counts: Counts;
};

const APPLY = process.argv.includes("--apply");

async function countOne(tenantId: string, sqlFrag: ReturnType<typeof sql>): Promise<number> {
  const r = await db.all<{ n: number }>(sqlFrag);
  return Number(r[0]?.n ?? 0);
}

async function findStrandedOwners(
  tenantId: string,
  currentOwnerId: string,
): Promise<StrandedOwner[]> {
  const rows = await db.all<{ from_person_id: string }>(sql`
    SELECT DISTINCT from_person_id
    FROM connections
    WHERE tenant_id = ${tenantId}
      AND from_person_id != ${currentOwnerId}
  `);
  const out: StrandedOwner[] = [];
  for (const r of rows) {
    const oldId = r.from_person_id;
    const personRow = await db
      .select({ fullName: schema.people.fullName })
      .from(schema.people)
      .where(eq(schema.people.id, oldId))
      .limit(1);
    out.push({
      oldId,
      oldName: personRow[0]?.fullName ?? null,
      counts: {
        connectionsFrom: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM connections WHERE tenant_id = ${tenantId} AND from_person_id = ${oldId}`),
        positions: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM positions WHERE tenant_id = ${tenantId} AND person_id = ${oldId}`),
        manualEdges: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM manual_edges WHERE tenant_id = ${tenantId} AND (person_a = ${oldId} OR person_b = ${oldId})`),
        messagesFrom: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ${tenantId} AND from_person_id = ${oldId}`),
        messagesTo: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ${tenantId} AND to_person_id = ${oldId}`),
        derivedEdges: await countOne(tenantId, sql`SELECT COUNT(*) AS n FROM derived_edges WHERE tenant_id = ${tenantId} AND (person_a = ${oldId} OR person_b = ${oldId})`),
      },
    });
  }
  return out;
}

async function rewriteOne(
  tenantId: string,
  currentOwnerId: string,
  oldId: string,
): Promise<void> {
  // connections: insert-or-ignore with the new from_person_id, then delete originals.
  // INSERT OR IGNORE handles the case where current_owner already has an edge to the same to_person_id.
  await db.run(sql`
    INSERT OR IGNORE INTO connections (tenant_id, from_person_id, to_person_id, source, connected_at)
    SELECT tenant_id, ${currentOwnerId}, to_person_id, source, connected_at
    FROM connections
    WHERE tenant_id = ${tenantId} AND from_person_id = ${oldId}
  `);
  await db.run(sql`
    DELETE FROM connections WHERE tenant_id = ${tenantId} AND from_person_id = ${oldId}
  `);

  // positions: person_id is the only thing changing; positions.id's deterministic
  // hash includes person_id but no other table looks up positions by id, so a
  // stale id is harmless. No collision possible because the hash differs.
  await db.run(sql`
    UPDATE positions SET person_id = ${currentOwnerId}
    WHERE tenant_id = ${tenantId} AND person_id = ${oldId}
  `);

  // manual_edges: must re-canonicalise (person_a < person_b lex) and avoid
  // any collision/self-loop with current_owner.
  // person_a = oldId rows → swap to (current_owner, person_b) sorted
  await db.run(sql`
    INSERT OR IGNORE INTO manual_edges (tenant_id, person_a, person_b, note, asserted_at)
    SELECT tenant_id,
      CASE WHEN ${currentOwnerId} < person_b THEN ${currentOwnerId} ELSE person_b END,
      CASE WHEN ${currentOwnerId} < person_b THEN person_b ELSE ${currentOwnerId} END,
      note, asserted_at
    FROM manual_edges
    WHERE tenant_id = ${tenantId}
      AND person_a = ${oldId}
      AND person_b != ${currentOwnerId}
  `);
  // person_b = oldId rows → swap to (person_a, current_owner) sorted
  await db.run(sql`
    INSERT OR IGNORE INTO manual_edges (tenant_id, person_a, person_b, note, asserted_at)
    SELECT tenant_id,
      CASE WHEN person_a < ${currentOwnerId} THEN person_a ELSE ${currentOwnerId} END,
      CASE WHEN person_a < ${currentOwnerId} THEN ${currentOwnerId} ELSE person_a END,
      note, asserted_at
    FROM manual_edges
    WHERE tenant_id = ${tenantId}
      AND person_b = ${oldId}
      AND person_a != ${currentOwnerId}
  `);
  // Drop originals (cascade from the final DELETE on people would catch them too)
  await db.run(sql`
    DELETE FROM manual_edges
    WHERE tenant_id = ${tenantId} AND (person_a = ${oldId} OR person_b = ${oldId})
  `);

  // messages: from/to are independent UPDATEs; messages.id is a deterministic
  // hash that becomes stale post-rewrite, but no FK / no UNIQUE on (from, to,
  // sentAt) so the stale id is harmless.
  await db.run(sql`
    UPDATE messages SET from_person_id = ${currentOwnerId}
    WHERE tenant_id = ${tenantId} AND from_person_id = ${oldId}
  `);
  await db.run(sql`
    UPDATE messages SET to_person_id = ${currentOwnerId}
    WHERE tenant_id = ${tenantId} AND to_person_id = ${oldId}
  `);

  // derived_edges: wipe any rows referencing the stranded id. The full
  // tenant's derived_edges is rebuilt by deriveSharedEmployerEdges after
  // the loop — these stranded rows would have been stale anyway because
  // their endpoints' position rows just got their person_id rewritten.
  await db.run(sql`
    DELETE FROM derived_edges
    WHERE tenant_id = ${tenantId} AND (person_a = ${oldId} OR person_b = ${oldId})
  `);

  // Finally, drop the stranded people row.
  await db.run(sql`DELETE FROM people WHERE id = ${oldId}`);
}

async function main() {
  console.log(
    `[repair-owner-orphans] mode: ${APPLY ? "APPLY (mutating)" : "DRY-RUN (no changes)"}`,
  );
  const tenants = await db.select().from(schema.tenants);
  console.log(`scanning ${tenants.length} tenant(s)`);

  let totalRepaired = 0;
  const tenantsNeedingRederive = new Set<string>();

  for (const tenant of tenants) {
    if (!tenant.ownerPersonId) {
      console.log(`\n[${tenant.id}] no ownerPersonId — skip`);
      continue;
    }
    const stranded = await findStrandedOwners(tenant.id, tenant.ownerPersonId);
    if (stranded.length === 0) {
      console.log(
        `\n[${tenant.id}] no stranded owners ✓ (current owner=${tenant.ownerPersonId.slice(0, 12)}…)`,
      );
      continue;
    }
    console.log(`\n[${tenant.id}] ${stranded.length} stranded owner(s) detected:`);
    for (const s of stranded) {
      const c = s.counts;
      console.log(
        `  ${s.oldId.slice(0, 12)}… "${s.oldName ?? "(no row)"}"  → ${tenant.ownerPersonId.slice(0, 12)}…`,
      );
      console.log(
        `    connections.from=${c.connectionsFrom} positions=${c.positions} manual_edges=${c.manualEdges} messages.from=${c.messagesFrom} messages.to=${c.messagesTo} derived_edges=${c.derivedEdges}`,
      );
    }
    if (APPLY) {
      for (const s of stranded) {
        await rewriteOne(tenant.id, tenant.ownerPersonId, s.oldId);
        totalRepaired++;
      }
      tenantsNeedingRederive.add(tenant.id);
    }
  }

  if (APPLY && tenantsNeedingRederive.size > 0) {
    console.log(
      `\nre-deriving shared-employer edges for ${tenantsNeedingRederive.size} tenant(s)...`,
    );
    for (const tid of tenantsNeedingRederive) {
      await deriveSharedEmployerEdges(tid, new Date());
    }
    console.log(`derived_edges rebuilt ✓`);
  }

  console.log(
    `\n[repair-owner-orphans] done — ${totalRepaired} stranded owner(s) repaired`,
  );
  if (!APPLY) {
    console.log(`(dry-run — re-run with --apply to mutate)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
