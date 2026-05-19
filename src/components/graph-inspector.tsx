"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { InspectorPayload } from "@/lib/queries/personInspector";

export function GraphInspector({
  personId,
  onClose,
}: {
  personId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<InspectorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/people/${encodeURIComponent(personId)}/inspector`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: InspectorPayload) => {
        if (!cancelled) setData(payload);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.aside
      key={personId}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.33, 1, 0.68, 1] }}
      className="flex h-full flex-col gap-4 border-l border-border-subtle bg-surface p-6 text-text-primary"
      aria-label="Person inspector"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
          Inspector
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-sm border border-border-subtle px-2 py-0.5 font-mono text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:text-text-primary"
        >
          Esc
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-border-subtle bg-overlay p-3 text-sm text-text-secondary">
          Couldn&rsquo;t load inspector — {error}
        </div>
      )}

      {!data && !error && (
        <div
          data-testid="inspector-skeleton"
          className="space-y-3"
        >
          <div className="h-8 w-3/4 animate-pulse rounded-sm bg-overlay" />
          <div className="h-4 w-2/3 animate-pulse rounded-sm bg-overlay" />
          <div className="h-4 w-1/2 animate-pulse rounded-sm bg-overlay" />
        </div>
      )}

      {data && (
        <>
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {data.fullName}
              {data.isOwner && (
                <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wider text-accent-warmth">
                  · you
                </span>
              )}
            </h2>
            {data.headline && (
              <p className="mt-1 text-sm text-text-secondary">{data.headline}</p>
            )}
          </div>

          {data.current && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                Current
              </p>
              <p className="mt-1 text-sm text-text-primary">
                {data.current.title ?? "—"}
                {data.current.companyName && (
                  <>
                    {" "}
                    <span className="text-text-secondary">at</span>{" "}
                    {data.current.companyName}
                  </>
                )}
              </p>
              {data.current.origin === "synthesised" && (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                  synthesised · dates unknown
                </p>
              )}
              {data.current.origin === "declared" && data.current.startDate && (
                <p className="mt-1 font-mono text-[10px] text-text-tertiary">
                  {data.current.startDate.slice(0, 7)}
                  {" — "}
                  {data.current.endDate
                    ? data.current.endDate.slice(0, 7)
                    : "present"}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
              Edges incident
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-text-secondary">manual</dt>
              <dd className="text-right font-mono">{data.edgeCounts.manual}</dd>
              <dt className="text-text-secondary">overlap (proven)</dt>
              <dd className="text-right font-mono">
                {data.edgeCounts.derivedOverlap}
              </dd>
              <dt className="text-text-secondary">currently</dt>
              <dd className="text-right font-mono">
                {data.edgeCounts.derivedCurrently}
              </dd>
              <dt className="text-text-secondary">no-overlap</dt>
              <dd className="text-right font-mono">
                {data.edgeCounts.derivedNoOverlap}
              </dd>
            </dl>
          </div>

          {data.connectedAt && !data.isOwner && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                Connected
              </p>
              <p className="mt-1 font-mono text-sm text-text-primary">
                {data.connectedAt}
              </p>
            </div>
          )}

          <nav className="mt-auto flex flex-col gap-2 border-t border-border-subtle pt-4">
            <InspectorLink
              href={`/people/${encodeURIComponent(data.id)}`}
              label="Open person page"
            />
            <InspectorLink
              href={`/queries/worked-with/${encodeURIComponent(data.id)}`}
              label="Worked-with query"
            />
            <InspectorLink
              href={`/queries/reach/${encodeURIComponent(data.id)}`}
              label="Reach to anyone"
            />
            {data.linkedinUrl && (
              <a
                href={data.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-secondary underline decoration-text-tertiary underline-offset-4 transition-colors duration-fast ease-cubic-out hover:text-accent-signal hover:decoration-accent-signal"
              >
                LinkedIn ↗
              </a>
            )}
          </nav>
        </>
      )}
    </motion.aside>
  );
}

function InspectorLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-sm border border-border-subtle px-3 py-2 text-sm text-text-primary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal"
    >
      {label}
    </Link>
  );
}
