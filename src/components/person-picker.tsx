"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = { id: string; fullName: string; headline: string | null };

// Person picker reused on /queries/worked-with and /queries/reach.
// Searches via /api/people/search and on click navigates to
// `${basePath}/${id}`. No state on the server — the URL changes,
// the destination page reads the [id] segment.
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
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/people/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data: { results: Candidate[] }) => setCandidates(data.results))
      .catch(() => {
        /* aborted — fine */
      });
  }, [q]);

  return (
    <div data-testid="person-picker" className="relative mt-6">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        autoComplete="off"
      />
      {candidates.length > 0 && (
        <ul
          data-testid="person-candidates"
          className="absolute z-10 mt-1 w-full divide-y divide-border rounded-sm border border-border bg-background shadow"
        >
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => router.push(`${basePath}/${c.id}`)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
              >
                <p className="font-medium">{c.fullName}</p>
                {c.headline && (
                  <p className="text-xs text-muted-foreground truncate">{c.headline}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
