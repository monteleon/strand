"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GraphInspector } from "./graph-inspector";
import { GraphFilters } from "./graph-filters";
import type { AssembledGraph, GraphEdgeKind } from "@/lib/queries/graph";

const NetworkGraph = dynamic(
  () => import("./network-graph").then((m) => m.NetworkGraph),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="graph-skeleton"
        className="h-full w-full animate-pulse bg-overlay"
      />
    ),
  },
);

type GraphCanvasProps = AssembledGraph & {
  initialKinds: GraphEdgeKind[];
  initialMinConfidence: number;
  initialMinDegree: number;
  // v0.4.0 (ISC-382, ISC-383): cap / company / scope forwarded to the
  // filter panel so the controls reflect the URL state on cold load.
  initialCap?: number;
  initialCompanyId?: string | null;
  initialCompanyName?: string | null;
  initialScope?: "current" | "ever";
};

export function GraphCanvas({
  nodes,
  edges,
  meta,
  initialKinds,
  initialMinConfidence,
  initialMinDegree,
  initialCap,
  initialCompanyId = null,
  initialCompanyName = null,
  initialScope = "current",
}: GraphCanvasProps) {
  // Selection state lives in React; URL is kept in sync via history.pushState
  // so the panel is deep-linkable and the back button steps through
  // selections. Next.js's router.push/router.replace silently drop a
  // query-only change on the current pathname in this app-router setup, so
  // we drive the URL ourselves and rely on a popstate listener for
  // back/forward navigation.
  const searchParams = useSearchParams();
  const [selectedId, setSelectedIdState] = useState<string | null>(
    () => searchParams.get("selected"),
  );

  const onSelect = useCallback((id: string | null) => {
    setSelectedIdState(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("selected", id);
    else params.delete("selected");
    const qs = params.toString();
    const url = qs ? `/graph?${qs}` : "/graph";
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState(null, "", url);
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedIdState(params.get("selected"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onClose = useCallback(() => onSelect(null), [onSelect]);

  if (nodes.length === 0) {
    // Filter panel still mounts so the user can relax aggressive filters
    // back into a populated graph without leaving the page.
    return (
      <div className="grid h-full w-full grid-cols-1 md:grid-cols-[1fr_360px]">
        <div className="relative h-full min-h-0 bg-canvas">
          <GraphFilters
            initialKinds={initialKinds}
            initialMinConfidence={initialMinConfidence}
            initialMinDegree={initialMinDegree}
            initialCap={initialCap}
            initialCompanyId={initialCompanyId}
            initialCompanyName={initialCompanyName}
            initialScope={initialScope}
          />
          <div className="flex h-full items-center justify-center p-12 text-text-secondary">
            <div
              data-testid="graph-empty"
              className="max-w-md rounded-md border border-border-subtle bg-surface p-6 text-sm"
            >
              No nodes meet the current filter. Relax the confidence slider or
              re-enable an edge kind to populate the graph.
            </div>
          </div>
        </div>
        <div className="relative h-full min-h-0 border-l border-border-subtle bg-surface" />
      </div>
    );
  }

  return (
    <div className="grid h-full w-full grid-cols-1 md:grid-cols-[1fr_360px]">
      <div className="relative h-full min-h-0 bg-canvas">
        <GraphFilters
          initialKinds={initialKinds}
          initialMinConfidence={initialMinConfidence}
          initialMinDegree={initialMinDegree}
          initialCap={initialCap}
          initialCompanyId={initialCompanyId}
          initialCompanyName={initialCompanyName}
          initialScope={initialScope}
        />
        <NetworkGraph
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
      <div className="relative h-full min-h-0 border-l border-border-subtle bg-surface">
        <AnimatePresence mode="wait" initial={false}>
          {selectedId ? (
            <GraphInspector
              key={`inspector-${selectedId}`}
              personId={selectedId}
              onClose={onClose}
            />
          ) : (
            <motion.aside
              key="rail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex h-full flex-col gap-6 p-6 text-text-primary"
              aria-label="Graph rail"
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                  Graph
                </p>
                <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
                  Your network
                </h1>
              </div>

              <p className="text-sm text-text-secondary">
                Owner in{" "}
                <span className="font-medium text-accent-warmth">amber</span>;
                other nodes coloured by current company so colleagues cluster
                together. Click any node to open the inspector.
              </p>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                  Stats
                </p>
                <dl
                  data-testid="graph-stats"
                  className="mt-2 grid grid-cols-2 gap-y-1 text-sm"
                >
                  <dt className="text-text-secondary">nodes</dt>
                  <dd className="text-right font-mono" data-stat="nodes">
                    {nodes.length}
                  </dd>
                  <dt className="text-text-secondary">edges</dt>
                  <dd
                    className="text-right font-mono"
                    data-stat="edges"
                    title={
                      meta.edgesTotal !== undefined && meta.edgesTotal > edges.length
                        ? `Showing top ${edges.length} of ${meta.edgesTotal} by confidence`
                        : undefined
                    }
                  >
                    {meta.edgesTotal !== undefined && meta.edgesTotal > edges.length
                      ? `${edges.length} / ${meta.edgesTotal.toLocaleString()}`
                      : edges.length}
                  </dd>
                  <dt className="text-text-secondary">candidates seen</dt>
                  <dd className="text-right font-mono" data-stat="candidates">
                    {meta.candidateCount.toLocaleString()}
                  </dd>
                  <dt className="text-text-secondary">confidence floor</dt>
                  <dd className="text-right font-mono" data-stat="confidence-floor">
                    {meta.highConfidenceFloor.toFixed(2)}
                  </dd>
                  <dt className="text-text-secondary">node cap</dt>
                  <dd className="text-right font-mono" data-stat="node-cap">
                    {meta.nodeCap}
                  </dd>
                </dl>
              </div>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                  Legend
                </p>
                <ul className="mt-2 space-y-2 text-xs text-text-secondary">
                  <LegendRow
                    swatchClass="bg-accent-warmth"
                    label="You (owner)"
                  />
                  <LegendRow
                    swatchClass="bg-accent-signal"
                    label="Manual edge — confidence 1.0"
                  />
                  <LegendRow
                    swatchClass="bg-accent-signal/70"
                    label="Derived overlap — proven date math"
                  />
                  <LegendRow
                    swatchClass="bg-accent-signal/30"
                    label="Currently together — no dates"
                  />
                </ul>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LegendRow({
  swatchClass,
  label,
}: {
  swatchClass: string;
  label: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`inline-block h-2 w-6 rounded-sm align-middle ${swatchClass}`}
      />
      <span>{label}</span>
    </li>
  );
}
