import { Suspense } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import {
  ALL_GRAPH_KINDS,
  assembleNetworkGraph,
  type GraphEdgeKind,
  type GraphScope,
} from "@/lib/queries/graph";

export const dynamic = "force-dynamic";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_MIN_DEGREE = 1;
const MAX_MIN_DEGREE = 20;
const DEFAULT_CAP = 150;
const MAX_CAP = 500;

function parseKinds(raw: string | string[] | undefined): GraphEdgeKind[] | undefined {
  if (!raw) return undefined;
  const csv = Array.isArray(raw) ? raw.join(",") : raw;
  const requested = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = requested.filter((k): k is GraphEdgeKind =>
    (ALL_GRAPH_KINDS as string[]).includes(k),
  );
  return valid.length > 0 ? valid : undefined;
}

function parseMinConfidence(raw: string | string[] | undefined): number | undefined {
  if (!raw) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n));
}

function parseMinDegree(raw: string | string[] | undefined): number | undefined {
  if (!raw) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(MAX_MIN_DEGREE, n));
}

// v0.4.0 (ISC-383, ISC-368, Advisor patch): cap is a DISCRETE control —
// only the dropdown's snap values are accepted. Anything else returns
// undefined which lets assembleNetworkGraph fall back to NODE_CAP (150).
// MAX_CAP retained for future "custom" affordance but unused on this path.
const ALLOWED_CAPS = [50, 100, 150, 250, 500];
function parseCap(raw: string | string[] | undefined): number | undefined {
  if (!raw) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return undefined;
  return ALLOWED_CAPS.includes(n) ? n : undefined;
}

function parseCompany(raw: string | string[] | undefined): string | undefined {
  if (!raw) return undefined;
  const s = (Array.isArray(raw) ? raw[0] : raw).trim();
  return s.length > 0 ? s : undefined;
}

function parseScope(raw: string | string[] | undefined): GraphScope | undefined {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === "ever") return "ever";
  if (s === "current") return "current";
  return undefined;
}

export default async function GraphPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const kinds = parseKinds(searchParams.kinds);
  const minConfidence = parseMinConfidence(searchParams.minConfidence);
  const minDegree = parseMinDegree(searchParams.minDegree);
  const cap = parseCap(searchParams.cap);
  const companyId = parseCompany(searchParams.company);
  const scope = parseScope(searchParams.scope);
  const data = await assembleNetworkGraph(undefined, {
    kinds,
    minConfidence,
    minDegree,
    cap,
    companyId,
    scope,
  });

  return (
    <Suspense fallback={null}>
      <GraphCanvas
        nodes={data.nodes}
        edges={data.edges}
        meta={data.meta}
        initialKinds={kinds ?? ALL_GRAPH_KINDS}
        initialMinConfidence={minConfidence ?? DEFAULT_MIN_CONFIDENCE}
        initialMinDegree={minDegree ?? DEFAULT_MIN_DEGREE}
        initialCap={cap ?? DEFAULT_CAP}
        initialCompanyId={companyId ?? null}
        initialCompanyName={data.meta.companyName ?? null}
        initialScope={scope ?? "current"}
      />
    </Suspense>
  );
}
