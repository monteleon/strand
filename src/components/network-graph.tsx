"use client";

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/queries/graph";

// Color literals mirror docs/tokens.md. Cytoscape config takes strings at
// construction time and can't read CSS variables, so the new design tokens
// are hardcoded here. Source of truth: docs/tokens.md.
const TOKEN_BG_CANVAS = "#0B0D10";
const TOKEN_TEXT_PRIMARY = "#E8ECF1";
const TOKEN_BORDER_SUBTLE = "#222831";
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

// Cluster colour by company. Same company hashes to the same hue across
// re-renders. Saturation/lightness tuned for the dark canvas — desaturated
// enough that the accent colours (warmth = you, signal = high-confidence/
// manual) still pop against them.
function colourForCompany(company: string | null): string {
  if (!company) return TOKEN_TEXT_TERTIARY;
  const hue = djb2(company) % 360;
  return `hsl(${hue}, 42%, 58%)`;
}

export function NetworkGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);

  // Keep the latest onSelect reachable from Cytoscape event handlers without
  // tearing down and re-creating cy on every render.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Cytoscape lifecycle is keyed on the data alone. Selection is a separate
  // effect below so node clicks don't trigger a full re-layout.
  //
  // The rAF-deferred construction is StrictMode-safe: React 18 dev runs the
  // effect twice (mount → cleanup → mount). Without the defer, cy is created,
  // immediately destroyed, then a second cy is created; meanwhile cose's
  // animation timers from the first cy fire after destroy and crash on a
  // null renderer. With the defer, the first run's rAF is cancelled before
  // cy is ever constructed — only the second run produces a live instance.
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
              label: n.displayName,
              company: n.company ?? "",
              isOwner: n.isOwner ? 1 : 0,
              degree: n.degree,
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
              kind: e.kind,
              confidence: e.confidence,
            },
            classes: e.kind,
          })),
        },
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              label: "data(label)",
              "font-size": "10px",
              color: TOKEN_TEXT_PRIMARY,
              "text-outline-width": 2,
              "text-outline-color": TOKEN_BG_CANVAS,
              "text-outline-opacity": 0.9,
              "text-margin-y": -4,
              "text-valign": "bottom",
              "text-halign": "center",
              "min-zoomed-font-size": 8,
              width: 16,
              height: 16,
              "border-width": 1,
              "border-color": TOKEN_BORDER_SUBTLE,
            },
          },
          {
            selector: "node.owner",
            style: {
              "background-color": TOKEN_ACCENT_WARMTH,
              width: 26,
              height: 26,
              "border-width": 2,
              "border-color": TOKEN_BG_CANVAS,
              "font-weight": "bold",
              "font-size": "12px",
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": TOKEN_BORDER_STRONG,
              "curve-style": "bezier",
              opacity: 0.6,
            },
          },
          {
            selector: "edge.manual",
            style: {
              "line-color": TOKEN_ACCENT_SIGNAL,
              width: 2,
              "line-style": "solid",
              opacity: 0.9,
            },
          },
          {
            selector: "edge.derived_overlap",
            style: {
              "line-color": TOKEN_ACCENT_SIGNAL,
              width: 1.5,
              "line-style": "dashed",
              opacity: 0.75,
            },
          },
          {
            selector: "edge.derived_currently",
            style: {
              "line-color": TOKEN_ACCENT_SIGNAL,
              width: 1,
              "line-style": "dashed",
              opacity: 0.4,
            },
          },
          {
            selector: "edge.derived_no_overlap",
            style: {
              "line-color": TOKEN_TEXT_TERTIARY,
              width: 1,
              "line-style": "dotted",
              opacity: 0.35,
            },
          },
          {
            selector: "node.strand-selected",
            style: {
              "border-width": 3,
              "border-color": TOKEN_ACCENT_WARMTH,
              "border-opacity": 1,
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

      cy.on("tap", "node", (evt) => {
        onSelectRef.current(evt.target.id());
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) onSelectRef.current(null);
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      if (cy) {
        cy.stop();
        cy.destroy();
      }
      cyRef.current = null;
    };
  }, [nodes, edges]);

  // Selection effect — independent of the Cytoscape lifecycle. Adds the
  // selection ring class and camera-pans to the selected node.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("strand-selected");
    if (!selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.empty()) return;
    node.addClass("strand-selected");
    cy.animate(
      {
        center: { eles: node },
        zoom: 1.5,
      },
      { duration: 480, easing: "ease-out-cubic" },
    );
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      data-testid="graph-container"
      className="h-full w-full bg-canvas"
    />
  );
}
