"use client";

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import { motion } from "framer-motion";
import type { GraphEdge, GraphNode } from "@/lib/queries/graph";

// Token literals — Cytoscape config strings can't read CSS variables. Source
// of truth in docs/tokens.md, mirrored in network-graph.tsx.
const TOKEN_BG_CANVAS = "#0B0D10";
const TOKEN_BORDER_STRONG = "#3A4250";
const TOKEN_ACCENT_SIGNAL = "#7DD3FC";
const TOKEN_ACCENT_WARMTH = "#F5C16C";
const TOKEN_TEXT_TERTIARY = "#5E6A7A";

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

// Non-interactive variant of NetworkGraph for the home hero. No labels, no
// camera pan, no tap handlers; pan/zoom disabled. Renders as a calm,
// dimmed backdrop behind the title card.
export function HeroGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cy: cytoscape.Core | null = null;
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current) return;
      cy = cytoscape({
        container: containerRef.current,
        elements: {
          nodes: nodes.map((n) => ({
            data: {
              id: n.id,
              color: n.isOwner
                ? TOKEN_ACCENT_WARMTH
                : colourForCompany(n.company),
            },
            classes: n.isOwner ? "owner" : "person",
          })),
          edges: edges.map((e) => ({
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
            },
            classes: e.kind,
          })),
        },
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              width: 8,
              height: 8,
              "border-width": 0,
              label: "",
            },
          },
          {
            selector: "node.owner",
            style: {
              "background-color": TOKEN_ACCENT_WARMTH,
              width: 18,
              height: 18,
              "border-width": 2,
              "border-color": TOKEN_BG_CANVAS,
            },
          },
          {
            selector: "edge",
            style: {
              width: 0.5,
              "line-color": TOKEN_BORDER_STRONG,
              "curve-style": "bezier",
              opacity: 0.4,
            },
          },
          {
            selector: "edge.manual",
            style: {
              "line-color": TOKEN_ACCENT_SIGNAL,
              width: 1,
              opacity: 0.6,
            },
          },
          {
            selector: "edge.derived_overlap",
            style: {
              "line-color": TOKEN_ACCENT_SIGNAL,
              width: 0.75,
              opacity: 0.4,
            },
          },
        ],
        layout: {
          name: "cose",
          animate: true,
          animationDuration: 2000,
          animationEasing: "ease-out-cubic",
          idealEdgeLength: 100,
          nodeOverlap: 4,
          randomize: true,
          componentSpacing: 100,
          nodeRepulsion: 350000,
          edgeElasticity: 100,
          gravity: 40,
          numIter: 800,
        } as cytoscape.LayoutOptions,
        userZoomingEnabled: false,
        userPanningEnabled: false,
        autoungrabify: true,
        boxSelectionEnabled: false,
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      if (cy) {
        cy.stop();
        cy.destroy();
      }
    };
  }, [nodes, edges]);

  // Slow continuous drift on the rendered canvas — pan + subtle scale,
  // 60-second loop. Reads as "alive" without re-running cose or fighting
  // Cytoscape's internal state. Reduced-motion users get a static graph.
  return (
    <motion.div
      aria-hidden="true"
      className="absolute inset-0 h-full w-full opacity-60 motion-reduce:transform-none"
      animate={{
        x: [0, 12, -10, 6, 0],
        y: [0, -8, 10, -4, 0],
        scale: [1, 1.02, 1, 1.03, 1],
      }}
      transition={{
        duration: 60,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </motion.div>
  );
}
