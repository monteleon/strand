import { Suspense } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { assembleNetworkGraph } from "@/lib/queries/graph";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const data = await assembleNetworkGraph();

  return (
    <Suspense fallback={null}>
      <GraphCanvas nodes={data.nodes} edges={data.edges} meta={data.meta} />
    </Suspense>
  );
}
