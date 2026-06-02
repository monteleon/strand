"use client";

// v0.4.0 (ISC-378): typeahead company search for the /graph filter panel.
// Mirrors person-picker.tsx — same AbortController debouncing, same
// ≥2-char gate at the API layer, same dropdown shape.
//
// Unlike person-picker (which navigates via router.push to a detail page),
// this returns the selection to the caller via onSelect. The /graph filter
// panel writes the URL itself so all three new params (cap / company /
// scope) update atomically.
import { useEffect, useRef, useState } from "react";
import { fetchResults } from "@/lib/fetch-results";

type Candidate = { id: string; name: string; peopleCount: number };

export function CompanyPicker({
  placeholder,
  onSelect,
}: {
  placeholder: string;
  onSelect: (companyId: string, companyName: string) => void;
}) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setCandidates([]);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchResults<Candidate>(
      `/api/companies/search?q=${encodeURIComponent(q)}`,
      { signal: ctrl.signal },
    ).then(setCandidates);
  }, [q]);

  return (
    <div data-testid="company-picker" className="relative">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
        autoComplete="off"
      />
      {candidates.length > 0 && (
        <ul
          data-testid="company-candidates"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto divide-y divide-border-subtle rounded-sm border border-border-subtle bg-overlay shadow-lg"
        >
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid="company-candidate"
                data-company-id={c.id}
                onClick={() => {
                  onSelect(c.id, c.name);
                  setQ("");
                  setCandidates([]);
                }}
                className="block w-full px-2 py-1.5 text-left text-xs transition-colors duration-fast ease-cubic-out hover:bg-surface"
              >
                <p className="font-medium text-text-primary">{c.name}</p>
                <p className="font-mono text-[10px] text-text-tertiary">
                  {c.peopleCount} {c.peopleCount === 1 ? "person" : "people"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
