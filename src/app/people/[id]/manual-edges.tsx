"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type IncidentEdge = {
  otherPersonId: string;
  otherPersonName: string;
  note: string | null;
  assertedAt: Date;
};

export function ManualEdges({
  personId,
  edges,
}: {
  personId: string;
  edges: IncidentEdge[];
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(otherId: string) {
    setRemoving(otherId);
    const res = await fetch("/api/edges/manual", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_a_id: personId, person_b_id: otherId }),
    });
    setRemoving(null);
    if (res.status === 204) {
      router.refresh();
    }
  }

  if (edges.length === 0) {
    return (
      <p
        data-testid="empty-manual-edges"
        className="text-sm text-text-secondary"
      >
        No manual connections asserted yet. Use the form below to add one.
      </p>
    );
  }

  return (
    <ul data-testid="manual-edges-list" className="space-y-2 text-sm">
      {edges.map((e) => (
        <li
          key={e.otherPersonId}
          className="flex items-baseline justify-between gap-3 rounded-md border border-border-subtle bg-surface px-4 py-3"
        >
          <div className="flex-1">
            <Link
              href={`/people/${e.otherPersonId}`}
              className="font-medium text-text-primary transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              {e.otherPersonName}
            </Link>
            {e.note && (
              <p className="mt-0.5 text-xs text-text-secondary">{e.note}</p>
            )}
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
              asserted {e.assertedAt.toISOString().slice(0, 10)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => remove(e.otherPersonId)}
            disabled={removing === e.otherPersonId}
            className="rounded-sm border border-border-subtle bg-overlay px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:text-text-primary disabled:opacity-50"
          >
            {removing === e.otherPersonId ? "Removing…" : "Remove"}
          </button>
        </li>
      ))}
    </ul>
  );
}
