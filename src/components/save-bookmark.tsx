"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SaveBookmark({ url }: { url: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setMessage(null);
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), url }),
    });
    setSubmitting(false);
    if (res.status === 201) {
      setMessage(`Saved "${name.trim()}".`);
      setName("");
      setOpen(false);
      router.refresh();
      return;
    }
    if (res.status === 409) {
      setMessage(`A bookmark named "${name.trim()}" already exists.`);
      return;
    }
    const err = await res.json().catch(() => ({}));
    setMessage(err.error ?? `Error: HTTP ${res.status}`);
  }

  if (!open) {
    return (
      <div data-testid="save-bookmark">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sm border border-border-subtle bg-overlay px-3 py-1.5 font-mono text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal"
        >
          Bookmark this query
        </button>
        {message && (
          <p
            data-testid="bookmark-message"
            className="mt-2 font-mono text-xs text-text-secondary"
          >
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="save-bookmark" className="space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bookmark name…"
        className="w-full rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !name.trim()}
          data-testid="confirm-save-bookmark"
          className="rounded-sm border border-accent-signal bg-accent-signal/15 px-3 py-1.5 text-xs font-medium text-accent-signal transition-colors duration-fast ease-cubic-out hover:bg-accent-signal/25 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          className="rounded-sm border border-border-subtle bg-overlay px-3 py-1.5 text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
      {message && (
        <p
          data-testid="bookmark-message"
          className="font-mono text-xs text-text-secondary"
        >
          {message}
        </p>
      )}
    </div>
  );
}
