"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ALL_GRAPH_KINDS,
  type GraphEdgeKind,
} from "@/lib/queries/graph-kinds";
import { CompanyPicker } from "@/components/company-picker";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const SLIDER_STEP = 0.05;
const DEFAULT_MIN_DEGREE = 1;
const MAX_MIN_DEGREE = 20;
// v0.4.0 (ISC-379, ISC-381): cap dropdown snap points + default.
// Default kept at 150 to preserve byte-identical regression for the no-
// param URL. MAX_NODE_CAP (500) bounds the upper end.
const DEFAULT_CAP = 150;
const CAP_OPTIONS = [50, 100, 150, 250, 500] as const;
type GraphScope = "current" | "ever";
const DEFAULT_SCOPE: GraphScope = "current";

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
  cap: number,
  companyId: string | null,
  scope: GraphScope,
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

  // v0.4.0: cap / company / scope params. Default values are elided so the
  // default URL stays byte-identical to pre-v0.4.0 (ISC-398).
  if (cap === DEFAULT_CAP) params.delete("cap");
  else params.set("cap", String(cap));

  if (!companyId) {
    params.delete("company");
    params.delete("scope"); // scope is meaningless without a company
  } else {
    params.set("company", companyId);
    if (scope === DEFAULT_SCOPE) params.delete("scope");
    else params.set("scope", scope);
  }

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

// v0.4.0 (Advisor patch): cap is a DISCRETE control — only the dropdown's
// snap values are accepted. Anything else (out-of-range, non-snap ints like
// 37, garbage strings) falls back to null which lets the caller use the
// component's default. URL ⇔ dropdown is an exact round-trip; no silent
// snap-on-render. Stance (1) from the Advisor commitment-boundary review.
function parseCapParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return (CAP_OPTIONS as readonly number[]).includes(n) ? n : null;
}

function parseScopeParam(raw: string | null): GraphScope | null {
  if (raw === "ever") return "ever";
  if (raw === "current") return "current";
  return null;
}

// v0.4.5: `?company=` (explicit empty) means CLEAR the filter — the user
// went to the trouble of putting the param in the URL with no value, so
// honour that. `/graph` with no `company` param at all is a different
// shape: "use whatever the SSR initial was." Conflating them (the old
// `searchParams.get("company")?.trim() || null ?? initialCompanyId`
// pattern) silently re-applied the SSR seed when the URL explicitly
// cleared the filter. Returns:
//   raw === null        → initialCompanyId (param absent)
//   raw is whitespace   → null              (param present, empty intent)
//   otherwise           → trimmed value     (param present with value)
// Exported for unit testing.
export function parseCompanyParam(
  raw: string | null,
  initialCompanyId: string | null,
): string | null {
  if (raw === null) return initialCompanyId;
  return raw.trim() || null;
}

export function GraphFilters({
  initialKinds,
  initialMinConfidence,
  initialMinDegree,
  initialCap = DEFAULT_CAP,
  initialCompanyId = null,
  initialCompanyName = null,
  initialScope = DEFAULT_SCOPE,
}: {
  initialKinds: GraphEdgeKind[];
  initialMinConfidence: number;
  initialMinDegree: number;
  initialCap?: number;
  initialCompanyId?: string | null;
  initialCompanyName?: string | null;
  initialScope?: GraphScope;
}) {
  const router = useRouter();
  // useSearchParams is the App Router's reactive URL hook. It re-fires on
  // back/forward navigation AND on router.refresh after our pushState, which
  // means we don't need a popstate listener. State is derived from it.
  const searchParams = useSearchParams();
  const urlKinds = parseKindsParam(searchParams.get("kinds")) ?? initialKinds;
  const urlMinConf = parseMinConfParam(searchParams.get("minConfidence")) ?? initialMinConfidence;
  const urlMinDeg = parseMinDegreeParam(searchParams.get("minDegree")) ?? initialMinDegree;
  const urlCap = parseCapParam(searchParams.get("cap")) ?? initialCap;
  const urlCompanyId = parseCompanyParam(searchParams.get("company"), initialCompanyId);
  const urlScope = parseScopeParam(searchParams.get("scope")) ?? initialScope;
  const [kinds, setKinds] = useState<GraphEdgeKind[]>(urlKinds);
  const [minConfidence, setMinConfidence] = useState<number>(urlMinConf);
  const [minDegree, setMinDegree] = useState<number>(urlMinDeg);
  const [cap, setCap] = useState<number>(urlCap);
  const [companyId, setCompanyId] = useState<string | null>(urlCompanyId);
  const [companyName, setCompanyName] = useState<string | null>(initialCompanyName);
  const [scope, setScope] = useState<GraphScope>(urlScope);

  // Keep local state in sync with URL — fires on Back/Forward navigation
  // (App Router updates searchParams on popstate) and on any router.refresh.
  useEffect(() => {
    setKinds(urlKinds);
    setMinConfidence(urlMinConf);
    setMinDegree(urlMinDeg);
    setCap(urlCap);
    setCompanyId(urlCompanyId);
    setScope(urlScope);
    // When companyId is cleared (or changed to a value the parent didn't
    // resolve), drop the displayed name so it doesn't lie. The page-level
    // server resolution re-populates initialCompanyName on the next render.
    if (urlCompanyId !== companyId) setCompanyName(initialCompanyName);
    // urlKinds / urlMinConf / urlMinDeg / urlCap / urlCompanyId / urlScope
    // are derived; tracking the underlying string keys is what matters —
    // they only change when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchParams.get("kinds"),
    searchParams.get("minConfidence"),
    searchParams.get("minDegree"),
    searchParams.get("cap"),
    searchParams.get("company"),
    searchParams.get("scope"),
    initialCompanyName,
  ]);

  // Single canonical URL writer. router.push navigates the App Router AND
  // triggers an RSC refetch for this dynamic = "force-dynamic" route.
  // Earlier versions used history.pushState + router.refresh, but refresh
  // re-fetches against the router's tree URL (unchanged by pushState), so
  // server-side filters silently no-op'd until a hard navigation.
  // scroll: false preserves graph viewport across filter changes.
  const apply = useCallback(
    (
      nextKinds: GraphEdgeKind[],
      nextMinConf: number,
      nextMinDeg: number,
      nextCap: number,
      nextCompanyId: string | null,
      nextScope: GraphScope,
    ) => {
      const url = urlFor(
        nextKinds,
        nextMinConf,
        nextMinDeg,
        nextCap,
        nextCompanyId,
        nextScope,
        window.location.search,
      );
      const current = window.location.pathname + window.location.search;
      if (url !== current) {
        router.push(url, { scroll: false });
      }
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
      apply(next, minConfidence, minDegree, cap, companyId, scope);
    },
    [kinds, minConfidence, minDegree, cap, companyId, scope, apply],
  );

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(e.target.value);
      if (!Number.isFinite(next)) return;
      setMinConfidence(next);
      apply(kinds, next, minDegree, cap, companyId, scope);
    },
    [kinds, minDegree, cap, companyId, scope, apply],
  );

  const onMinDegreeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseInt(e.target.value, 10);
      if (!Number.isFinite(next)) return;
      const clamped = Math.max(1, Math.min(MAX_MIN_DEGREE, next));
      setMinDegree(clamped);
      apply(kinds, minConfidence, clamped, cap, companyId, scope);
    },
    [kinds, minConfidence, cap, companyId, scope, apply],
  );

  const onCapChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = parseInt(e.target.value, 10);
      if (!Number.isFinite(next)) return;
      setCap(next);
      apply(kinds, minConfidence, minDegree, next, companyId, scope);
    },
    [kinds, minConfidence, minDegree, companyId, scope, apply],
  );

  const onCompanySelect = useCallback(
    (id: string, name: string) => {
      setCompanyId(id);
      setCompanyName(name);
      // New company picked → reset scope to default. The toggle then
      // becomes visible.
      setScope(DEFAULT_SCOPE);
      apply(kinds, minConfidence, minDegree, cap, id, DEFAULT_SCOPE);
    },
    [kinds, minConfidence, minDegree, cap, apply],
  );

  const onCompanyClear = useCallback(() => {
    setCompanyId(null);
    setCompanyName(null);
    setScope(DEFAULT_SCOPE);
    apply(kinds, minConfidence, minDegree, cap, null, DEFAULT_SCOPE);
  }, [kinds, minConfidence, minDegree, cap, apply]);

  const onScopeChange = useCallback(
    (next: GraphScope) => {
      setScope(next);
      apply(kinds, minConfidence, minDegree, cap, companyId, next);
    },
    [kinds, minConfidence, minDegree, cap, companyId, apply],
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

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">Max people</span>
          <span
            className="font-mono text-text-primary"
            data-testid="cap-value"
          >
            {cap}
          </span>
        </div>
        <select
          value={cap}
          onChange={onCapChange}
          aria-label="Maximum number of people"
          data-testid="cap-select"
          className="mt-2 w-full rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary"
        >
          {CAP_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}{opt === DEFAULT_CAP ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">At company</span>
          {companyId && (
            <button
              type="button"
              data-testid="company-clear"
              onClick={onCompanyClear}
              className="font-mono text-[10px] text-text-tertiary transition-colors duration-fast ease-cubic-out hover:text-text-primary"
              aria-label="Clear company filter"
            >
              × clear
            </button>
          )}
        </div>
        {companyId && companyName ? (
          <p
            data-testid="company-active"
            data-company-id={companyId}
            className="mt-2 truncate rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-1 text-xs text-accent-signal"
            title={companyName}
          >
            {companyName}
          </p>
        ) : (
          <div className="mt-2">
            <CompanyPicker
              placeholder="Type ≥2 chars…"
              onSelect={onCompanySelect}
            />
          </div>
        )}
        {companyId && (
          <div
            data-testid="scope-toggle"
            className="mt-2 flex items-center gap-1 rounded-sm border border-border-subtle bg-surface p-0.5 font-mono text-[10px] uppercase tracking-wide"
          >
            <button
              type="button"
              data-testid="scope-current"
              aria-pressed={scope === "current"}
              onClick={() => onScopeChange("current")}
              className={
                "flex-1 rounded-sm px-2 py-0.5 transition-colors " +
                (scope === "current"
                  ? "bg-accent-signal/15 text-accent-signal"
                  : "text-text-tertiary hover:text-text-secondary")
              }
            >
              Current
            </button>
            <button
              type="button"
              data-testid="scope-ever"
              aria-pressed={scope === "ever"}
              onClick={() => onScopeChange("ever")}
              className={
                "flex-1 rounded-sm px-2 py-0.5 transition-colors " +
                (scope === "ever"
                  ? "bg-accent-warmth/15 text-accent-warmth"
                  : "text-text-tertiary hover:text-text-secondary")
              }
            >
              Ever
            </button>
          </div>
        )}
        <p className="mt-1 text-[11px] leading-snug text-text-tertiary">
          {companyId
            ? scope === "current"
              ? "People currently at this company."
              : "People who ever worked at this company."
            : "Restrict the graph to one company."}
        </p>
      </div>
    </div>
  );
}
