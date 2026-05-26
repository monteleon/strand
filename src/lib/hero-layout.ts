// v0.4.2 — deterministic clustered-radial layout for the homepage hero.
// Replaces the runtime cose layout that previously ran inside cytoscape on
// the client. Server-renderable, dep-free, sub-ms for ~150 nodes. Owner is
// placed at the viewBox centre; every other node belongs to a company
// cluster whose centroid sits on a ring around the owner. Within a cluster,
// nodes are scattered on a sub-circle whose angle is hashed from the node
// id — same input always produces the same output (no Math.random).

import type { GraphNode, GraphEdge } from "@/lib/queries/graph";

export type HeroPoint = { id: string; x: number; y: number };

export type HeroLayoutOptions = {
  width?: number;
  height?: number;
  clusterRing?: number;
  innerJitter?: number;
};

const DEFAULTS = {
  width: 1000,
  height: 600,
  clusterRing: 220,
  innerJitter: 70,
} as const;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function computeHeroPositions(
  nodes: GraphNode[],
  _edges: GraphEdge[],
  opts: HeroLayoutOptions = {},
): HeroPoint[] {
  const width = opts.width ?? DEFAULTS.width;
  const height = opts.height ?? DEFAULTS.height;
  const clusterRing = opts.clusterRing ?? DEFAULTS.clusterRing;
  const innerJitter = opts.innerJitter ?? DEFAULTS.innerJitter;
  const cx = width / 2;
  const cy = height / 2;
  const pad = 16;

  // Group non-owner nodes by company; null company → "__independent__".
  const groups = new Map<string, GraphNode[]>();
  let owner: GraphNode | null = null;
  for (const n of nodes) {
    if (n.isOwner) {
      owner = n;
      continue;
    }
    const key = n.company ?? "__independent__";
    const bucket = groups.get(key);
    if (bucket) bucket.push(n);
    else groups.set(key, [n]);
  }

  // Sort group keys deterministically so cluster angle assignment is stable
  // regardless of input ordering.
  const keys = Array.from(groups.keys()).sort();
  const points: HeroPoint[] = [];

  if (owner) {
    points.push({ id: owner.id, x: cx, y: cy });
  }

  const groupCount = Math.max(keys.length, 1);
  keys.forEach((key, idx) => {
    const bucket = groups.get(key)!;
    const angle = (idx / groupCount) * Math.PI * 2;
    const ccx = cx + Math.cos(angle) * clusterRing;
    const ccy = cy + Math.sin(angle) * clusterRing;

    // Sub-radius scales with cluster size — big clusters spread more.
    const subR = Math.min(
      innerJitter,
      14 + Math.sqrt(bucket.length) * 14,
    );

    bucket.forEach((n) => {
      const h = djb2(n.id);
      const subAngle = (h % 360) * (Math.PI / 180);
      // Two hashed dimensions so big clusters fill, not just ring.
      const radial = (((h >>> 9) % 100) / 100) * subR;
      const x = clamp(ccx + Math.cos(subAngle) * radial, pad, width - pad);
      const y = clamp(ccy + Math.sin(subAngle) * radial, pad, height - pad);
      points.push({ id: n.id, x, y });
    });
  });

  return points;
}
