import nextDynamic from "next/dynamic";
import { assembleNetworkGraph } from "@/lib/queries/graph";

export const dynamic = "force-dynamic";

// Cytoscape touches `document`, so the NetworkGraph component must render
// client-side only. Server renders an empty container; client hydrates and
// instantiates Cytoscape against real DOM.
const NetworkGraph = nextDynamic(
  () => import("@/components/network-graph").then((m) => m.NetworkGraph),
  { ssr: false, loading: () => <GraphSkeleton /> },
);

function GraphSkeleton() {
  return (
    <div
      data-testid="graph-skeleton"
      className="h-[70vh] w-full animate-pulse rounded-md border border-border bg-muted/10"
    />
  );
}

export default async function GraphPage() {
  const { nodes, edges, meta } = await assembleNetworkGraph();

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="border-b border-border pb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Graph
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Your network
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Force-directed view of your network. Owner in{" "}
          <span className="font-medium text-rose-600">red</span>; other nodes
          coloured by current company so colleagues cluster together. Manual
          edges in orange (solid); derived edges in blue (dashed —{" "}
          <span className="font-medium">overlap</span> stronger than{" "}
          <span className="font-medium">currently</span>).
        </p>
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="graph-meta"
        >
          {nodes.length} {nodes.length === 1 ? "node" : "nodes"} ·{" "}
          {edges.length} {edges.length === 1 ? "edge" : "edges"} (capped at{" "}
          {meta.nodeCap} nodes; confidence ≥ {meta.highConfidenceFloor};{" "}
          {meta.candidateCount.toLocaleString()} candidates seen).
        </p>
      </header>

      <section className="mt-8">
        {nodes.length === 0 ? (
          <div
            data-testid="graph-empty"
            className="rounded-md border border-border bg-muted/10 p-6 text-sm text-muted-foreground"
          >
            No nodes meet the confidence floor. Import a LinkedIn export and
            run the derive job to populate the graph.
          </div>
        ) : (
          <NetworkGraph nodes={nodes} edges={edges} />
        )}
      </section>

      <section className="mt-8 text-xs text-muted-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wider">
          Legend
        </h2>
        <ul className="mt-2 space-y-1">
          <li>
            <span className="inline-block h-2 w-6 align-middle bg-amber-600 rounded-sm" />{" "}
            Manual edge (asserted by you, confidence 1.0)
          </li>
          <li>
            <span className="inline-block h-2 w-6 align-middle bg-sky-600 rounded-sm" />{" "}
            Derived overlap (real date math, 0.7 – 0.9)
          </li>
          <li>
            <span className="inline-block h-2 w-6 align-middle bg-sky-400 rounded-sm" />{" "}
            Currently together at same company (no overlap math, 0.7+)
          </li>
        </ul>
      </section>
    </main>
  );
}
