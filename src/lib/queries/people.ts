import { and, eq, like, ne, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { PAGE_SIZE, pageWindow, type PageParams } from "@/lib/pagination";
import {
  listAllLastContactDesc,
  listLastContactByPeople,
} from "@/lib/queries/messages";

export type PeopleSort = "name" | "last_contact";

export type PeoplePageRow = {
  id: string;
  fullName: string;
  headline: string | null;
  linkedinUrl: string | null;
  connectedAt: string | null;
  lastContactAt: Date | null;
};

export async function getOwnerId(tenantId: string = LOCAL_TENANT_ID) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return tenant?.ownerPersonId ?? null;
}

// Owner is excluded by left-joining tenants on owner_person_id and
// filtering rows where people.id != owner_person_id.
function baseWhere(tenantId: string, ownerId: string | null, q: string) {
  const tenantFilter = eq(schema.people.tenantId, tenantId);
  const excludeOwner = ownerId
    ? ne(schema.people.id, ownerId)
    : undefined;
  // Case-insensitive substring on full_name using LIKE + LOWER. Parameterised
  // via Drizzle's bound value — `q` is never string-concatenated into SQL.
  const search = q
    ? sql`lower(${schema.people.fullName}) LIKE ${"%" + q.toLowerCase() + "%"}`
    : undefined;
  return and(tenantFilter, excludeOwner, search);
}

// ISC-257: unknown sort values fall back to default. Whitelist-narrowing
// happens here so callers can pass searchParams.sort directly without
// pre-validation.
export function coerceSort(raw: string | undefined): PeopleSort {
  return raw === "last_contact" ? "last_contact" : "name";
}

export async function listPeople(
  params: PageParams,
  sort: PeopleSort = "name",
  tenantId: string = LOCAL_TENANT_ID,
): Promise<{ rows: PeoplePageRow[]; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }> {
  const ownerId = await getOwnerId(tenantId);

  const where = baseWhere(tenantId, ownerId, params.q);
  const totalRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.people)
    .where(where);
  const total = Number(totalRow[0]?.n ?? 0);
  const { offset, totalPages, hasNext, hasPrev } = pageWindow(params.page, total);

  // sort=name path (default): existing people+connections select for the
  // visible page only, then batch-load last-contact via the messages
  // module. Two queries here, plus one batched messages query = 3 total.
  // No per-row queries.
  if (sort === "name") {
    const pageRows = await db
      .select({
        id: schema.people.id,
        fullName: schema.people.fullName,
        headline: schema.people.headline,
        linkedinUrl: schema.people.linkedinUrl,
        connectedAt: schema.connections.connectedAt,
      })
      .from(schema.people)
      .leftJoin(
        schema.connections,
        and(
          eq(schema.connections.tenantId, tenantId),
          eq(schema.connections.toPersonId, schema.people.id),
        ),
      )
      .where(where)
      .orderBy(schema.people.fullName)
      .limit(PAGE_SIZE)
      .offset(offset);

    const lastByPerson = await listLastContactByPeople(
      pageRows.map((r) => r.id),
      tenantId,
    );
    const rows: PeoplePageRow[] = pageRows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      headline: r.headline,
      linkedinUrl: r.linkedinUrl,
      connectedAt: r.connectedAt,
      lastContactAt: lastByPerson.get(r.id) ?? null,
    }));
    return { rows, total, totalPages, hasNext, hasPrev };
  }

  // sort=last_contact path: composite ordering across two modules. The
  // messages module owns the "ordered list of contacted people" half;
  // the people module owns the alphabetical tail of "people with no
  // messages". Compose in JS to keep the module boundary clean — ISC-266
  // enforces that the messages table is not referenced from this module
  // at the SQL layer.
  //
  // Three queries here (count above + people-set + messages-ordered = 3),
  // composed in O(P + M) JS where P = matching people (~1.8k) and
  // M = people-with-messages (~few hundred).
  const allPeople = await db
    .select({
      id: schema.people.id,
      fullName: schema.people.fullName,
      headline: schema.people.headline,
      linkedinUrl: schema.people.linkedinUrl,
      connectedAt: schema.connections.connectedAt,
    })
    .from(schema.people)
    .leftJoin(
      schema.connections,
      and(
        eq(schema.connections.tenantId, tenantId),
        eq(schema.connections.toPersonId, schema.people.id),
      ),
    )
    .where(where)
    .orderBy(schema.people.fullName);

  const orderedContacted = await listAllLastContactDesc(tenantId);
  const lastByPerson = new Map(
    orderedContacted.map((o) => [o.personId, o.lastAt] as const),
  );
  const eligibleIds = new Set(allPeople.map((p) => p.id));

  // Front: people-with-messages, in messages-module-supplied order, filtered
  // to the eligible (q-matched, owner-excluded) set.
  const front: typeof allPeople = [];
  for (const o of orderedContacted) {
    if (!eligibleIds.has(o.personId)) continue;
    const person = allPeople.find((p) => p.id === o.personId);
    if (person) front.push(person);
  }
  // Back: people in the eligible set NOT in front, alphabetical (already
  // sorted by the SELECT's ORDER BY).
  const frontIds = new Set(front.map((p) => p.id));
  const back = allPeople.filter((p) => !frontIds.has(p.id));
  const composed = [...front, ...back];

  const pageRows = composed.slice(offset, offset + PAGE_SIZE);
  const rows: PeoplePageRow[] = pageRows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    headline: r.headline,
    linkedinUrl: r.linkedinUrl,
    connectedAt: r.connectedAt,
    lastContactAt: lastByPerson.get(r.id) ?? null,
  }));
  return { rows, total, totalPages, hasNext, hasPrev };
}

export async function getPersonById(
  id: string,
  tenantId: string = LOCAL_TENANT_ID,
) {
  const [person] = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.tenantId, tenantId), eq(schema.people.id, id)))
    .limit(1);
  if (!person) return null;

  const positions = await db
    .select({
      id: schema.positions.id,
      title: schema.positions.title,
      startDate: schema.positions.startDate,
      endDate: schema.positions.endDate,
      current: schema.positions.current,
      origin: schema.positions.origin,
      companyId: schema.positions.companyId,
      companyName: schema.companies.name,
    })
    .from(schema.positions)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.positions.companyId))
    .where(eq(schema.positions.personId, id))
    .orderBy(sql`CASE ${schema.positions.origin} WHEN 'declared' THEN 0 ELSE 1 END`);

  const [connection] = await db
    .select({ connectedAt: schema.connections.connectedAt })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.tenantId, tenantId),
        eq(schema.connections.toPersonId, id),
      ),
    )
    .limit(1);

  return { person, positions, connectedAt: connection?.connectedAt ?? null };
}

export async function searchPeople(
  q: string,
  limit: number = 10,
  tenantId: string = LOCAL_TENANT_ID,
) {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const ownerId = await getOwnerId(tenantId);
  const conditions = and(
    eq(schema.people.tenantId, tenantId),
    ownerId ? ne(schema.people.id, ownerId) : undefined,
    sql`lower(${schema.people.fullName}) LIKE ${"%" + trimmed.toLowerCase() + "%"}`,
  );
  return db
    .select({
      id: schema.people.id,
      fullName: schema.people.fullName,
      headline: schema.people.headline,
    })
    .from(schema.people)
    .where(conditions)
    .orderBy(schema.people.fullName)
    .limit(limit);
}

// LIKE expression matcher used for /companies — alias re-exported here so the
// companies query module can use the same parameterised-substring pattern.
export const likeIgnoreCase = (q: string) => like(sql`lower(x)`, `%${q}%`);

// W5b — connections-by-year histogram. Owner is excluded. NULL connected_at
// is bucketed under "unknown". substr(connected_at, 1, 4) is safe because
// connected_at is stored as YYYY-MM-DD (parser enforces this format).
export type ConnectionYearBucket = { year: string; count: number };

export async function listConnectionYears(
  tenantId: string = LOCAL_TENANT_ID,
): Promise<ConnectionYearBucket[]> {
  const ownerId = await getOwnerId(tenantId);
  const rows = await db.all<{ year: string | null; n: number }>(sql`
    SELECT
      CASE
        WHEN c.connected_at IS NULL THEN NULL
        ELSE substr(c.connected_at, 1, 4)
      END AS year,
      COUNT(*) AS n
    FROM connections c
    WHERE c.tenant_id = ${tenantId}
      ${ownerId ? sql`AND c.to_person_id != ${ownerId}` : sql``}
    GROUP BY year
    ORDER BY (year IS NULL) ASC, year DESC
  `);
  return rows.map((r) => ({
    year: r.year ?? "unknown",
    count: r.n,
  }));
}

// People connected in a given year. `year="unknown"` matches NULL.
export async function listPeopleByYear(
  year: string,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<Array<{ id: string; fullName: string; headline: string | null; connectedAt: string | null }>> {
  const ownerId = await getOwnerId(tenantId);
  const yearFilter =
    year === "unknown"
      ? sql`AND c.connected_at IS NULL`
      : sql`AND substr(c.connected_at, 1, 4) = ${year}`;
  const rows = await db.all<{
    id: string;
    full_name: string;
    headline: string | null;
    connected_at: string | null;
  }>(sql`
    SELECT p.id, p.full_name, p.headline, c.connected_at
    FROM connections c
    INNER JOIN people p ON p.id = c.to_person_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      ${ownerId ? sql`AND c.to_person_id != ${ownerId}` : sql``}
      ${yearFilter}
    ORDER BY p.full_name ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    headline: r.headline,
    connectedAt: r.connected_at,
  }));
}
