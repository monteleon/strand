// One-off timing: instrument the SQL boundaries in assembleNetworkGraph
// directly to attribute the 1.6s warm path
import { db, schema, LOCAL_TENANT_ID } from "@/lib/db";
import { sql, and, eq, inArray } from "drizzle-orm";

const tenantId = "local";

console.log("--- segment timing on warm cache ---");
for (let pass = 0; pass < 3; pass++) {
  console.log(`pass ${pass}:`);

  let t = performance.now();
  const [tenant] = await db.all<{ owner_person_id: string | null }>(sql`
    SELECT owner_person_id FROM tenants WHERE id = ${tenantId} LIMIT 1
  `);
  console.log(`  tenant query: ${(performance.now() - t).toFixed(0)}ms`);

  t = performance.now();
  const candidates = await db.all<{ person_id: string; best_confidence: number; edge_count: number }>(sql`
    SELECT person_id, MAX(confidence) AS best_confidence, COUNT(*) AS edge_count
    FROM (
      SELECT me.person_a AS person_id, 1.0 AS confidence FROM manual_edges me WHERE me.tenant_id = ${tenantId}
      UNION ALL
      SELECT me.person_b AS person_id, 1.0 AS confidence FROM manual_edges me WHERE me.tenant_id = ${tenantId}
      UNION ALL
      SELECT e.person_a AS person_id, e.confidence FROM derived_edges e WHERE e.tenant_id = ${tenantId} AND e.confidence >= 0.7
      UNION ALL
      SELECT e.person_b AS person_id, e.confidence FROM derived_edges e WHERE e.tenant_id = ${tenantId} AND e.confidence >= 0.7
    ) GROUP BY person_id ORDER BY best_confidence DESC, edge_count DESC
  `);
  console.log(`  candidates query (UNION ALL 4×): ${(performance.now() - t).toFixed(0)}ms (${candidates.length} rows)`);

  const idsList = candidates.slice(0, 150).map((c) => c.person_id);
  const idsSql = sql.join(idsList.map((id) => sql`${id}`), sql`, `);

  t = performance.now();
  const employerRows = await db.all<{ person_id: string; company_name: string }>(sql`
    WITH ranked AS (
      SELECT po.person_id, c.name AS company_name,
        ROW_NUMBER() OVER (
          PARTITION BY po.person_id
          ORDER BY CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END, po.current DESC, COALESCE(po.start_date, '0000-00-00') DESC
        ) AS rn
      FROM positions po
      JOIN companies c ON c.id = po.company_id AND c.tenant_id = po.tenant_id
      WHERE po.tenant_id = ${tenantId} AND po.person_id IN (${idsSql})
    )
    SELECT person_id, company_name FROM ranked WHERE rn = 1
  `);
  console.log(`  employer rows (windowed): ${(performance.now() - t).toFixed(0)}ms (${employerRows.length} rows)`);

  t = performance.now();
  const peopleRows = await db.all<{ id: string; full_name: string }>(sql`
    SELECT p.id, p.full_name FROM people p WHERE p.tenant_id = ${tenantId} AND p.id IN (${idsSql})
  `);
  console.log(`  people rows: ${(performance.now() - t).toFixed(0)}ms (${peopleRows.length} rows)`);

  t = performance.now();
  const derivedEdgesRows = await db.all(sql`
    SELECT person_a, person_b, kind, confidence,
      json_extract(evidence_json, '$.companyName') AS company_name,
      CAST(json_extract(evidence_json, '$.overlapMonths') AS INTEGER) AS overlap_months
    FROM derived_edges
    WHERE tenant_id = ${tenantId}
      AND confidence >= 0.7
      AND person_a IN (${idsSql})
      AND person_b IN (${idsSql})
  `);
  console.log(`  derived edges query: ${(performance.now() - t).toFixed(0)}ms (${derivedEdgesRows.length} rows)`);
}
