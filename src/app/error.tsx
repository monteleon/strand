"use client";

import Link from "next/link";
import { useEffect } from "react";

// Route-level error boundary. A thrown query (locked DB, bad migration, a bug)
// used to fall through to Next's bare default screen with no way back. The
// message itself is not shown — it can carry SQL or file paths — only Next's
// digest, which matches the entry in the server log.

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-8 py-16 text-text-primary">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-overlay/85 px-8 py-7 text-center shadow-2xl">
        <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
          error
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          This page failed to load
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Something went wrong reading your network. Trying again usually works
          after an ingest finishes; if it keeps failing, check the server log.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">
            digest {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-accent-signal px-4 py-2 font-mono text-xs text-accent-signal transition-colors duration-fast ease-cubic-out hover:bg-accent-signal/10"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-border-subtle px-4 py-2 font-mono text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
