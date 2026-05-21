// v0.3.4 perf bench — measure assembleNetworkGraph isolated from Next.js dev
// server overhead. Reads timing of the SQL+composition path only.
import { assembleNetworkGraph } from "@/lib/queries/graph";

// Warm the libsql connection + the route compile is not a factor here.
await assembleNetworkGraph("local");

console.log("--- assembleNetworkGraph default filters ---");
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const r = await assembleNetworkGraph("local");
  console.log(`  ${i}: ${(performance.now() - t0).toFixed(0)}ms (${r.nodes.length} nodes / ${r.edges.length} edges)`);
}

console.log("--- assembleNetworkGraph minConfidence=0 ---");
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const r = await assembleNetworkGraph("local", { minConfidence: 0 });
  console.log(`  ${i}: ${(performance.now() - t0).toFixed(0)}ms (${r.nodes.length} nodes / ${r.edges.length} edges)`);
}
