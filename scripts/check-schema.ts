import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const counts = await db.all<{ origin: string; n: number }>(
  sql`SELECT origin, COUNT(*) as n FROM positions WHERE tenant_id='local' GROUP BY origin`,
);
console.log("origin counts:", counts);

const top = await db.all<{ name: string; people_count: number }>(sql`
  SELECT c.name, COUNT(DISTINCT p.person_id) AS people_count
  FROM companies c
  LEFT JOIN positions p ON p.company_id = c.id AND p.tenant_id = c.tenant_id
  WHERE c.tenant_id = 'local'
  GROUP BY c.id
  ORDER BY people_count DESC, c.name ASC
  LIMIT 10
`);
console.log("top 10 companies by people:");
for (const r of top) console.log(`  ${r.people_count.toString().padStart(4)} | ${r.name}`);

const pwc = await db.all<{ id: string; name: string; people_count: number }>(sql`
  SELECT c.id, c.name, COUNT(DISTINCT p.person_id) AS people_count
  FROM companies c
  LEFT JOIN positions p ON p.company_id = c.id AND p.tenant_id = c.tenant_id
  WHERE c.tenant_id = 'local'
    AND lower(c.normalized_name) LIKE '%pwc%'
  GROUP BY c.id
  ORDER BY people_count DESC
`);
console.log("pwc-matching companies:");
for (const r of pwc) console.log(`  ${r.people_count.toString().padStart(4)} | ${r.name} (${r.id})`);
