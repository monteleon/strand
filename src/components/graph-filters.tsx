"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ALL_GRAPH_KINDS,
  type GraphEdgeKind,
} from "@/lib/queries/graph-kinds";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const SLIDER_STEP = 0.05;
const DEFAULT_MIN_DEGREE = 1;
const MAX_MIN_DEGREE = 20;

const KIND_LABEL: Record<GraphEdgeKind, string> = {
  manual: "Manual",
  derived_overlap: "Overlap",
  derived_currently: "Currently",
  derived_no_overlap: "No overlap",
};

const KIND_HINT: Record<GraphEdgeKind, string> = {
  manual: "edges you asserted (confidence 1.0)",
  derived_overlap: "shared employer, real overlapping dates",
  derived_currently: "shared employer, currently, no dates",
  derived_no_overlap: "shared employer, non-overlapping dates",
};

function urlFor(
  kinds: GraphEdgeKind[],
  minConfidence: number,
  minDegree: number,
  search: string,
): string {
  const params = new URLSearchParams(search);
  // Omit defaults so the canonical `/graph` URL stays clean.
  const isDefaultKinds =
    kinds.length === ALL_GRAPH_KINDS.length &&
    ALL_GRAPH_KINDS.every((k) => kinds.includes(k));
  if (isDefaultKinds) params.delete("kinds");
  else params.set("kinds", kinds.join(","));

  if (Math.abs(minConfidence - DEFAULT_MIN_CONFIDENCE) < 1e-6) params.delete("minConfidence");
  else params.set("minConfidence", minConfidence.toFixed(2));

  if (minDegree <= DEFAULT_MIN_DEGREE) params.delete("minDegree");
  else params.set("minDegree", String(minDegree));

  const qs = params.toString();
  return qs ? `/graph?${qs}` : "/graph";
}

function parseKindsParam(raw: string | null): GraphEdgeKind[] | null {
  if (!raw) return null;
  const valid = raw
    .split(",")
    .map((s) => s.trim())
    .filter((k): k is GraphEdgeKind => (ALL_GRAPH_KINDS as string[]).includes(k));
  return valid.length > 0 ? valid : null;
}

function parseMinConfParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function parseMinDegreeParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(MAX_MIN_DEGREE, n));
}

export function GraphFilters({
  initialKinds,
  initialMinConfidence,
  initialMinDegree,
}: {
  initialKinds: GraphEdgeKind[];
  initialMinConfidence: number;
  initialMinDegree: number;
}) {
  const router = useRouter();
  // useSearchParams is the App Router's reactive URL hook. It re-fires on
  // back/forward navigation AND on router.refresh after our pushState, which
  // means we don't need a popstate listener. State is derived from it.
  const searchParams = useSearchParams();
  const urlKinds = parseKindsParam(searchParams.get("kinds")) ?? initialKinds;
  const urlMinConf = parseMinConfParam(searchParams.get("minConfidence")) ?? initialMinConfidence;
  const urlMinDeg = parseMinDegreeParam(searchParams.get("minDegree")) ?? initialMinDegree;
  const [kinds, setKinds] = useState<GraphEdgeKind[]>(urlKinds);
  const [minConfidence, setMinConfidence] = useState<number>(urlMinConf);
  const [minDegree, setMinDegree] = useState<number>(urlMinDeg);

  // Keep local state in sync with URL — fires on Back/Forward navigation
  // (App Router updates searchParams on popstate) and on any router.refresh.
  useEffect(() => {
    setKinds(urlKinds);
    setMinConfidence(urlMinConf);
    setMinDegree(urlMinDeg);
    // urlKinds / urlMinConf / urlMinDeg are derived; tracking the underlying
    // string keys is what matters — they only change when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchParams.get("kinds"),
    searchParams.get("minConfidence"),
    searchParams.get("minDegree"),
  ]);

  // Single canonical URL writer. Same pattern as `?selected=` in
  // graph-canvas.tsx — history.pushState + router.refresh — because
  // Next 14 App Router silently dedups query-only router.push/replace
  // on the same pathname in this app. Documented in ISA Decisions
  // (2026-05-19 v0.2.0 graph URL pattern).
  const apply = useCallback(
    (nextKinds: GraphEdgeKind[], nextMinConf: number, nextMinDeg: number) => {
      const url = urlFor(nextKinds, nextMinConf, nextMinDeg, window.location.search);
      const current = window.location.pathname + window.location.search;
      if (url !== current) {
        window.history.pushState(null, "", url);
      }
      router.refresh();
    },
    [router],
  );

  const toggleKind = useCallback(
    (kind: GraphEdgeKind) => {
      const isOn = kinds.includes(kind);
      const next = isOn ? kinds.filter((k) => k !== kind) : [...kinds, kind];
      // At least one kind must remain selected (ISC-209). Deselect attempts
      // when this is the only selection are no-ops.
      if (next.length === 0) return;
      setKinds(next);
      apply(next, minConfidence, minDegree);
    },
    [kinds, minConfidence, minDegree, apply],
  );

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(e.target.value);
      if (!Number.isFinite(next)) return;
      setMinConfidence(next);
      apply(kinds, next, minDegree);
    },
    [kinds, minDegree, apply],
  );

  const onMinDegreeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseInt(e.target.value, 10);
      if (!Number.isFinite(next)) return;
      const clamped = Math.max(1, Math.min(MAX_MIN_DEGREE, next));
      setMinDegree(clamped);
      apply(kinds, minConfidence, clamped);
    },
    [kinds, minConfidence, apply],
  );

  return (
    <div
      data-testid="graph-filters"
      className="absolute right-4 top-4 z-10 w-64 rounded-md border border-border-subtle bg-overlay/95 p-4 text-text-primary shadow-lg backdrop-blur"
      aria-label="Graph filters"
    >
      <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
        Filter
      </p>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">Edge kinds</span>
          <span className="font-mono text-text-tertiary">
            {kinds.length}/{ALL_GRAPH_KINDS.length}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALL_GRAPH_KINDS.map((kind) => {
            const on = kinds.includes(kind);
            const onlyOne = kinds.length === 1 && on;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                disabled={onlyOne}
                title={KIND_HINT[kind]}
                aria-pressed={on}
                data-testid={`kind-chip-${kind}`}
                className={
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
                  (on
                    ? "border-accent-signal bg-accent-signal/15 text-accent-signal"
                    : "border-border-subtle bg-transparent text-text-secondary hover:border-border-strong hover:text-text-primary") +
                  (onlyOne ? " cursor-not-allowed opacity-80" : " cursor-pointer")
                }
              >
                {KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">Min confidence</span>
          <span
            className="font-mono text-text-primary"
            data-testid="confidence-value"
          >
            ≥ {minConfidence.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={SLIDER_STEP}
          value={minConfidence}
          onChange={onSliderChange}
          aria-label="Minimum confidence"
          data-testid="confidence-slider"
          className="mt-2 w-full accent-accent-signal"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-text-tertiary">
          <span>0.0</span>
          <span>0.5</span>
          <span>1.0</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">Min edges per node</span>
          <span
            className="font-mono text-text-primary"
            data-testid="min-degree-value"
          >
            {minDegree === 1 ? "any" : `≥ ${minDegree}`}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={MAX_MIN_DEGREE}
          step={1}
          value={minDegree}
          onChange={onMinDegreeChange}
          aria-label="Minimum edges per node"
          data-testid="min-degree-slider"
          className="mt-2 w-full accent-accent-signal"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-text-tertiary">
          <span>1</span>
          <span>{Math.round(MAX_MIN_DEGREE / 2)}</span>
          <span>{MAX_MIN_DEGREE}</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-text-tertiary">
          Hide leaf nodes — show only people connected to ≥ N others.
        </p>
      </div>
    </div>
  );
}
