// Client-safe vocabulary for graph edge kinds. Kept in its own module so
// "use client" components (e.g. graph-filters.tsx) can import the type +
// the canonical list WITHOUT pulling in graph.ts's server-only DB module,
// which transitively imports node:fs via @libsql/client and breaks the
// webpack client build with UnhandledSchemeError.

export type GraphEdgeKind =
  | "manual"
  | "derived_overlap"
  | "derived_currently"
  | "derived_no_overlap";

export const ALL_GRAPH_KINDS: GraphEdgeKind[] = [
  "manual",
  "derived_overlap",
  "derived_currently",
  "derived_no_overlap",
];
