import { and, eq, sql } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { PAGE_SIZE, pageWindow, type PageParams } from "@/lib/pagination";

export type CompanyPageRow = {
  id: string;
  name: string;
  peopleCount: number;
};

function baseWhere(tenantId: string, q: string) {
  const tenant = eq(schema.companies.tenantId, tenantId);
  const search = q
    ? sql`lower(${schema.companies.normalizedName}) LIKE ${"%" + q.toLowerCase() + "%"}`
    : undefined;
  return and(tenant, search);
}

export async function listCompanies(
  params: PageParams,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<{ rows: CompanyPageRow[]; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }> {
  const where = baseWhere(tenantId, params.q);

  const totalRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.companies)
    .where(where);
  const total = Number(totalRow[0]?.n ?? 0);
  const { offset, totalPages, hasNext, hasPrev } = pageWindow(params.page, total);

  // people-count := number of DISTINCT people who have a position at this company
  // (a person at the same company multiple times shouldn't double-count).
  const rows = await db.all<{
    id: string;
    name: string;
    people_count: number;
  }>(sql`
    SELECT c.id, c.name, COUNT(DISTINCT p.person_id) AS people_count
    FROM companies c
    LEFT JOIN positions p ON p.company_id = c.id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      ${params.q ? sql`AND lower(c.normalized_name) LIKE ${"%" + params.q.toLowerCase() + "%"}` : sql``}
    GROUP BY c.id
    ORDER BY people_count DESC, c.name ASC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `);

  return {
    rows: rows.map((r) => ({ id: r.id, name: r.name, peopleCount: r.people_count })),
    total,
    totalPages,
    hasNext,
    hasPrev,
  };
}

export async function getCompanyById(
  id: string,
  tenantId: string = LOCAL_TENANT_ID,
) {
  const [company] = await db
    .select()
    .from(schema.companies)
    .where(
      and(eq(schema.companies.tenantId, tenantId), eq(schema.companies.id, id)),
    )
    .limit(1);
  if (!company) return null;

  const people = await db
    .select({
      id: schema.people.id,
      fullName: schema.people.fullName,
      headline: schema.people.headline,
      title: schema.positions.title,
      startDate: schema.positions.startDate,
      endDate: schema.positions.endDate,
      current: schema.positions.current,
      origin: schema.positions.origin,
    })
    .from(schema.positions)
    .innerJoin(
      schema.people,
      and(
        eq(schema.people.tenantId, tenantId),
        eq(schema.people.id, schema.positions.personId),
      ),
    )
    .where(
      and(
        eq(schema.positions.tenantId, tenantId),
        eq(schema.positions.companyId, id),
      ),
    )
    .orderBy(
      sql`CASE ${schema.positions.origin} WHEN 'declared' THEN 0 ELSE 1 END`,
      schema.people.fullName,
    );

  return { company, people };
}

// W5: filtered + sorted "people at company X" query for the /queries
// surface. Status filter walks `positions.current`; sort options:
//  - "declared-first" (default): declared positions first, then alphabetical
//  - "name": pure alphabetical
//  - "connected": most recently connected (LinkedIn connection date) first
// Connection-date sort needs a LEFT JOIN to the connections table; null
// connection dates (the owner) sort last.
export type AtCompanyStatus = "any" | "current" | "past";
export type AtCompanySort = "declared-first" | "name" | "connected";

export type AtCompanyRow = {
  id: string;
  fullName: string;
  headline: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  origin: "declared" | "synthesised";
  connectedAt: string | null;
};

export async function listAtCompany(
  companyId: string,
  status: AtCompanyStatus,
  sort: AtCompanySort,
  tenantId: string = LOCAL_TENANT_ID,
): Promise<AtCompanyRow[]> {
  // Status WHERE clause is a parameterised sqlite int comparison.
  const statusSql =
    status === "current"
      ? sql`AND po.current = 1`
      : status === "past"
        ? sql`AND po.current = 0`
        : sql``;
  // Sort ORDER BY — declared-first puts origin='declared' rows on top,
  // then ties broken alphabetically; name is pure alphabetical;
  // connected sorts by connection date desc (newest first).
  const orderSql =
    sort === "name"
      ? sql`ORDER BY p.full_name ASC`
      : sort === "connected"
        ? sql`ORDER BY (conn.connected_at IS NULL) ASC, conn.connected_at DESC, p.full_name ASC`
        : sql`ORDER BY CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END, p.full_name ASC`;
  const rows = await db.all<{
    id: string;
    full_name: string;
    headline: string | null;
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    current: number;
    origin: string;
    connected_at: string | null;
  }>(sql`
    SELECT p.id, p.full_name, p.headline,
           po.title, po.start_date, po.end_date, po.current, po.origin,
           conn.connected_at
    FROM positions po
    INNER JOIN people p ON p.id = po.person_id AND p.tenant_id = po.tenant_id
    LEFT JOIN connections conn ON conn.tenant_id = po.tenant_id
      AND conn.to_person_id = p.id
    WHERE po.tenant_id = ${tenantId}
      AND po.company_id = ${companyId}
      ${statusSql}
    ${orderSql}
  `);
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    headline: r.headline,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    current: r.current === 1,
    origin: r.origin as "declared" | "synthesised",
    connectedAt: r.connected_at,
  }));
}
