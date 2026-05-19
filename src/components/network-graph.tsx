"use client";

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/queries/graph";

// Stable hash → hue for company-cluster colouring. The same company name
// always gets the same colour across re-renders and refreshes; people who
// share a company cluster together visually under the cose layout.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}
function colourForCompany(company: string | null): string {
  if (!company) return "#9ca3af"; // muted gray
  const hue = djb2(company) % 360;
  return `hsl(${hue}, 55%, 60%)`;
}

export function NetworkGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: {
        nodes: nodes.map((n) => ({
          data: {
            id: n.id,
            label: n.displayName,
            company: n.company ?? "",
            isOwner: n.isOwner ? 1 : 0,
            degree: n.degree,
            color: n.isOwner ? "#dc2626" : colourForCompany(n.company),
          },
          classes: n.isOwner ? "owner" : "person",
        })),
        edges: edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.kind,
            confidence: e.confidence,
          },
          classes: e.kind, // "manual" | "derived_overlap" | "derived_currently" | "derived_no_overlap"
        })),
      },
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            "font-size": "10px",
            color: "#f8fafc",
            "text-outline-width": 2,
            "text-outline-color": "#0f172a",
            "text-outline-opacity": 0.9,
            "text-margin-y": -4,
            "text-valign": "bottom",
            "text-halign": "center",
            "min-zoomed-font-size": 8,
            width: 16,
            height: 16,
            "border-width": 1,
            "border-color": "#0f172a33",
          },
        },
        {
          selector: "node.owner",
          style: {
            "background-color": "#dc2626",
            width: 26,
            height: 26,
            "border-width": 2,
            "border-color": "#0f172a",
            "font-weight": "bold",
            "font-size": "12px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#64748b",
            "curve-style": "bezier",
            opacity: 0.7,
          },
        },
        {
          selector: "edge.manual",
          style: {
            "line-color": "#d97706",
            width: 2,
            "line-style": "solid",
          },
        },
        {
          selector: "edge.derived_overlap",
          style: {
            "line-color": "#0284c7",
            width: 1.5,
            "line-style": "dashed",
          },
        },
        {
          selector: "edge.derived_currently",
          style: {
            "line-color": "#0ea5e9",
            width: 1,
            "line-style": "dashed",
            opacity: 0.5,
          },
        },
        {
          selector: "edge.derived_no_overlap",
          style: {
            "line-color": "#94a3b8",
            width: 1,
            "line-style": "dotted",
            opacity: 0.4,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#0f172a",
          },
        },
      ],
      layout: {
        name: "cose",
        animate: true,
        animationDuration: 1500,
        animationEasing: "ease-out-cubic",
        idealEdgeLength: 80,
        nodeOverlap: 4,
        randomize: true,
        componentSpacing: 80,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        gravity: 80,
        numIter: 1000,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges]);

  return (
    <div
      ref={containerRef}
      data-testid="graph-container"
      className="h-[70vh] w-full rounded-md border border-border bg-muted/5"
    />
  );
}
