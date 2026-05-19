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
      className="ml-2 rounded-sm border border-border-subtle bg-overlay px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-tertiary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:text-text-primary disabled:opacity-50"
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}
