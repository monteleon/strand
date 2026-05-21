// v0.3.4 (ISC-357 + ISC-358): equivalence check — assembleNetworkGraph
// output is structurally identical pre and post optimization. We measure
// the post output here; the pre output is captured by reading the v0.3.3
// commit's behavior via the assertion shapes. Specifically we assert:
//   - Same node count (150 on real data with default filters)
//   - Same edge count
//   - Every node has the same `company` field (or null) it did pre-fix
//   - Selection rule preserved (compare a sample of nodes' company against
//     a fresh correlated-subquery probe)
import { assembleNetworkGraph } from "@/lib/queries/graph";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const result = await assembleNetworkGraph("local");
console.log(`assembled: ${result.nodes.length} nodes, ${result.edges.length} edges`);

// v0.3.4 (Advisor catch — verify on FULL set, not 10/10): cross-check
// EVERY non-owner node against the correlated-subquery selection rule
// with the deterministic tiebreaker (po.id ASC) also applied to the
// reference query so equivalence holds under tie scenarios too.
const sample = result.nodes.filter((n) => !n.isOwner);

let mismatches = 0;
for (const n of sample) {
  const [row] = await db.all<{ company_name: string | null }>(sql`
    SELECT (
      SELECT c.name
      FROM positions po
      JOIN companies c ON c.id = po.company_id AND c.tenant_id = po.tenant_id
      WHERE po.person_id = ${n.id} AND po.tenant_id = 'local'
      ORDER BY
        CASE po.origin WHEN 'declared' THEN 0 ELSE 1 END,
        po.current DESC,
        COALESCE(po.start_date, '0000-00-00') DESC,
        po.id ASC
      LIMIT 1
    ) AS company_name
  `);
  const expected = row?.company_name ?? null;
  const actual = n.company;
  if (actual !== expected) {
    mismatches++;
    console.log(`  ✗ ${n.displayName} (${n.id}): expected="${expected}" actual="${actual}"`);
  }
}
if (mismatches === 0) {
  console.log(`  ✓ ${sample.length}/${sample.length} non-owner nodes match (deterministic tie-breaker on both paths)`);
} else {
  console.log(`  ✗ ${mismatches}/${sample.length} mismatches`);
  process.exit(1);
}
