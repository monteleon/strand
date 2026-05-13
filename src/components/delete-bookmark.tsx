"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteBookmark({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.status === 204 || res.status === 404) {
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={busy}
      aria-label={`Delete bookmark ${name}`}
      data-testid="delete-bookmark"
      className="ml-2 rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}
