import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

console.log("--- top 5 highest-confidence shared_employer_overlap edges by months ---");
const top = await db.all<{
  person_a_name: string;
  person_b_name: string;
  kind: string;
  confidence: number;
  evidence_json: string;
}>(sql`
  SELECT pa.full_name AS person_a_name, pb.full_name AS person_b_name,
         e.kind, e.confidence, e.evidence_json
  FROM derived_edges e
  JOIN people pa ON pa.id = e.person_a
  JOIN people pb ON pb.id = e.person_b
  WHERE e.tenant_id = 'local' AND e.kind = 'shared_employer_overlap'
  ORDER BY e.confidence DESC,
           json_extract(e.evidence_json, '$.overlapMonths') DESC
  LIMIT 8
`);
for (const e of top) {
  const ev = JSON.parse(e.evidence_json);
  console.log(`  ${e.person_a_name}  ↔  ${e.person_b_name}  | conf=${e.confidence}  | ${ev.companyName}  | ${ev.overlapMonths}mo  | declaredCount=${ev.declaredCount}  | bothCurrent=${ev.bothCurrent}`);
}

console.log();
console.log("--- shared_employer_no_overlap sample ---");
const no = await db.all<{
  person_a_name: string;
  person_b_name: string;
  evidence_json: string;
}>(sql`
  SELECT pa.full_name AS person_a_name, pb.full_name AS person_b_name, e.evidence_json
  FROM derived_edges e
  JOIN people pa ON pa.id = e.person_a
  JOIN people pb ON pb.id = e.person_b
  WHERE e.tenant_id = 'local' AND e.kind = 'shared_employer_no_overlap'
  LIMIT 8
`);
for (const e of no) {
  const ev = JSON.parse(e.evidence_json);
  console.log(`  ${e.person_a_name}  ↔  ${e.person_b_name}  | ${ev.companyName}  | months=${ev.overlapMonths}`);
}

console.log();
console.log("--- distribution by confidence ---");
const dist = await db.all<{ confidence: number; n: number }>(sql`
  SELECT confidence, COUNT(*) AS n FROM derived_edges
  WHERE tenant_id='local' GROUP BY confidence ORDER BY confidence DESC
`);
for (const r of dist) console.log(`  ${r.confidence}: ${r.n}`);

console.log();
console.log("--- edges incident to owner (should be substantial) ---");
const ownerEdges = await db.all<{ n: number }>(sql`
  SELECT COUNT(*) AS n FROM derived_edges e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.tenant_id='local'
    AND (e.person_a = t.owner_person_id OR e.person_b = t.owner_person_id)
`);
console.log(`  total: ${ownerEdges[0]?.n}`);
const ownerByCo = await db.all<{ companyName: string; n: number; months_max: number }>(sql`
  SELECT json_extract(e.evidence_json, '$.companyName') AS companyName,
         COUNT(*) AS n,
         MAX(json_extract(e.evidence_json, '$.overlapMonths')) AS months_max
  FROM derived_edges e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.tenant_id='local'
    AND (e.person_a = t.owner_person_id OR e.person_b = t.owner_person_id)
  GROUP BY companyName
  ORDER BY n DESC
`);
for (const r of ownerByCo) console.log(`  ${r.n.toString().padStart(4)}  ${r.months_max.toString().padStart(3)}mo  ${r.companyName}`);
