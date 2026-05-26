// v0.4.2 — server-rendered static SVG hero. Replaces the prior client-side
// cytoscape + framer-motion implementation: zero `cytoscape` on the homepage
// chunk, zero `useEffect`, zero `requestAnimationFrame`. Drift animation is
// a single CSS keyframe (`hero-drift`) declared in tailwind.config.ts and
// honoured by `motion-reduce:animate-none` (Tailwind variant emits the
// `@media (prefers-reduced-motion: reduce)` rule). Layout positions are
// computed server-side via `computeHeroPositions` — deterministic, sub-ms
// for the ~150-node graph the server already assembles for /graph.
//
// SERVER ONLY: do NOT import this from a `"use client"` component — doing
// so re-pulls the module into the client graph and unwinds the bundle win.

import type { GraphEdge, GraphNode } from "@/lib/queries/graph";
import { computeHeroPositions } from "@/lib/hero-layout";

// Token literals — kept inline for parity with the prior implementation and
// for self-containedness; source of truth is `docs/tokens.md`, mirrored in
// `network-graph.tsx`.
const TOKEN_BG_CANVAS = "#0B0D10";
const TOKEN_BORDER_STRONG = "#3A4250";
const TOKEN_ACCENT_SIGNAL = "#7DD3FC";
const TOKEN_ACCENT_WARMTH = "#F5C16C";
const TOKEN_TEXT_TERTIARY = "#5E6A7A";

const VIEWBOX_W = 1000;
const VIEWBOX_H = 600;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

function colourForCompany(company: string | null): string {
  if (!company) return TOKEN_TEXT_TERTIARY;
  const hue = djb2(company) % 360;
  return `hsl(${hue}, 42%, 58%)`;
}

function edgeStyle(kind: GraphEdge["kind"]): { stroke: string; width: number; opacity: number } {
  switch (kind) {
    case "manual":
      return { stroke: TOKEN_ACCENT_SIGNAL, width: 1, opacity: 0.6 };
    case "derived_overlap":
      return { stroke: TOKEN_ACCENT_SIGNAL, width: 0.75, opacity: 0.4 };
    default:
      return { stroke: TOKEN_BORDER_STRONG, width: 0.5, opacity: 0.4 };
  }
}

export function HeroGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const points = computeHeroPositions(nodes, edges, {
    width: VIEWBOX_W,
    height: VIEWBOX_H,
  });
  const pos = new Map(points.map((p) => [p.id, p]));

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 h-full w-full opacity-60 animate-hero-drift motion-reduce:animate-none"
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >
        <g>
          {edges.map((e) => {
            const s = pos.get(e.source);
            const t = pos.get(e.target);
            if (!s || !t) return null;
            const st = edgeStyle(e.kind);
            return (
              <line
                key={e.id}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={st.stroke}
                strokeWidth={st.width}
                strokeOpacity={st.opacity}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            if (n.isOwner) {
              return (
                <circle
                  key={n.id}
                  cx={p.x}
                  cy={p.y}
                  r={9}
                  fill={TOKEN_ACCENT_WARMTH}
                  stroke={TOKEN_BG_CANVAS}
                  strokeWidth={2}
                />
              );
            }
            return (
              <circle
                key={n.id}
                cx={p.x}
                cy={p.y}
                r={4}
                fill={colourForCompany(n.company)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
