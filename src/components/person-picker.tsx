"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchResults } from "@/lib/fetch-results";

type Candidate = { id: string; fullName: string; headline: string | null };

export function PersonPicker({
  basePath,
  placeholder,
}: {
  basePath: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setCandidates([]);
      return;
    }
    // v0.4.19 (review-#7): adopt fetchResults so a 5xx / error-envelope
    // response can't crash this typeahead (setCandidates(undefined) →
    // candidates.length TypeError). The cancelled guard is required
    // because fetchResults swallows AbortError into [] — without it, a
    // stale aborted request's .then(setCandidates([])) could land after
    // the newer request's setCandidates(real), clobbering the dropdown.
    let cancelled = false;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchResults<Candidate>(
      `/api/people/search?q=${encodeURIComponent(q)}`,
      { signal: ctrl.signal },
    ).then((rs) => {
      if (!cancelled) setCandidates(rs);
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <div data-testid="person-picker" className="relative mt-6">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
        autoComplete="off"
      />
      {candidates.length > 0 && (
        <ul
          data-testid="person-candidates"
          className="absolute z-10 mt-1 w-full divide-y divide-border-subtle rounded-sm border border-border-subtle bg-overlay shadow-lg"
        >
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => router.push(`${basePath}/${c.id}`)}
                className="block w-full px-3 py-2 text-left text-sm transition-colors duration-fast ease-cubic-out hover:bg-surface"
              >
                <p className="font-medium text-text-primary">{c.fullName}</p>
                {c.headline && (
                  <p className="truncate text-xs text-text-secondary">
                    {c.headline}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
