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
      <p data-testid="empty-manual-edges" className="text-sm text-muted-foreground">
        No manual connections asserted yet. Use the form below to add one.
      </p>
    );
  }

  return (
    <ul data-testid="manual-edges-list" className="space-y-2 text-sm">
      {edges.map((e) => (
        <li
          key={e.otherPersonId}
          className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/10 px-4 py-3"
        >
          <div className="flex-1">
            <Link
              href={`/people/${e.otherPersonId}`}
              className="font-medium hover:underline"
            >
              {e.otherPersonName}
            </Link>
            {e.note && (
              <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>
            )}
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              asserted {e.assertedAt.toISOString().slice(0, 10)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => remove(e.otherPersonId)}
            disabled={removing === e.otherPersonId}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
          >
            {removing === e.otherPersonId ? "Removing…" : "Remove"}
          </button>
        </li>
      ))}
    </ul>
  );
}
