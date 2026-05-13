"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/people/search?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(personId)}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data: { results: Candidate[] }) => setCandidates(data.results))
      .catch(() => {
        /* aborted or transient — fine */
      });
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
    <div data-testid="add-connection" className="rounded-md border border-border bg-muted/10 px-4 py-4">
      <p className="text-sm font-medium">Add a connection</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Assert that this person knows someone else in your network. Stored
        locally; never sent anywhere.
      </p>

      {!picked && (
        <div className="mt-3 relative">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search another person…"
            className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
            autoComplete="off"
          />
          {candidates.length > 0 && (
            <ul
              data-testid="candidates"
              className="absolute z-10 mt-1 w-full divide-y divide-border rounded-sm border border-border bg-background shadow"
            >
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(c)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    <p className="font-medium">{c.fullName}</p>
                    {c.headline && (
                      <p className="text-xs text-muted-foreground truncate">
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
          <div className="rounded-sm border border-border bg-background px-3 py-2 text-sm">
            <p className="font-medium">{picked.fullName}</p>
            {picked.headline && (
              <p className="text-xs text-muted-foreground">{picked.headline}</p>
            )}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g., met at conf 2023, former colleagues, etc."
            className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              data-testid="confirm-add-connection"
              className="rounded-sm border border-border bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Add connection"}
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p data-testid="add-message" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
