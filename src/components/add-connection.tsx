"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchResults } from "@/lib/fetch-results";

type Candidate = { id: string; fullName: string; headline: string | null };

export function AddConnection({ personId }: { personId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (picked) {
      setCandidates([]);
      return;
    }
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
    const url = `/api/people/search?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(personId)}`;
    fetchResults<Candidate>(url, { signal: ctrl.signal }).then((rs) => {
      if (!cancelled) setCandidates(rs);
    });
    return () => {
      cancelled = true;
    };
  }, [q, personId, picked]);

  async function submit() {
    if (!picked) return;
    setSubmitting(true);
    setMessage(null);
    const res = await fetch("/api/edges/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_a_id: personId,
        person_b_id: picked.id,
        note: note.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (res.status === 201) {
      setMessage(`Added connection to ${picked.fullName}.`);
    } else if (res.status === 200) {
      setMessage(`Already connected to ${picked.fullName}.`);
    } else {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error ?? `Error: HTTP ${res.status}`);
      return;
    }
    setPicked(null);
    setQ("");
    setNote("");
    router.refresh();
  }

  return (
    <div
      data-testid="add-connection"
      className="rounded-md border border-border-subtle bg-surface px-4 py-4"
    >
      <p className="font-medium text-text-primary">Add a connection</p>
      <p className="mt-1 text-xs text-text-secondary">
        Assert that this person knows someone else in your network. Stored
        locally; never sent anywhere.
      </p>

      {!picked && (
        <div className="relative mt-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search another person…"
            className="w-full rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
            autoComplete="off"
          />
          {candidates.length > 0 && (
            <ul
              data-testid="candidates"
              className="absolute z-10 mt-1 w-full divide-y divide-border-subtle rounded-sm border border-border-subtle bg-overlay shadow-lg"
            >
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(c)}
                    className="block w-full px-3 py-2 text-left text-sm transition-colors duration-fast ease-cubic-out hover:bg-surface"
                  >
                    <p className="font-medium text-text-primary">
                      {c.fullName}
                    </p>
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
      )}

      {picked && (
        <div className="mt-3 space-y-3">
          <div className="rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm">
            <p className="font-medium text-text-primary">{picked.fullName}</p>
            {picked.headline && (
              <p className="text-xs text-text-secondary">{picked.headline}</p>
            )}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g., met at conf 2023, former colleagues, etc."
            className="w-full rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              data-testid="confirm-add-connection"
              className="rounded-sm border border-accent-signal bg-accent-signal/15 px-3 py-1.5 text-sm font-medium text-accent-signal transition-colors duration-fast ease-cubic-out hover:bg-accent-signal/25 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Add connection"}
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-sm border border-border-subtle bg-overlay px-3 py-1.5 text-sm text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          data-testid="add-message"
          className="mt-3 font-mono text-xs text-text-secondary"
        >
          {message}
        </p>
      )}
    </div>
  );
}
