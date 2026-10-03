import Link from "next/link";

// Renders for unknown URLs AND every `notFound()` call — e.g. /people/[id],
// /companies/[id], /queries/reach/[id] and /queries/worked-with/[id] when the
// id isn't in this database (stale bookmark, link from an older export).

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-8 py-16 text-text-primary">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-overlay/85 px-8 py-7 text-center shadow-2xl">
        <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
          404 · not found
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          Nothing at this address
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          That person, company or page isn&apos;t in your network. The link may
          come from an older export, or it may be mistyped.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <NavLink href="/people" label="Browse people" />
          <NavLink href="/graph" label="Explore graph" />
          <NavLink href="/" label="Home" />
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border-subtle px-4 py-2 font-mono text-xs text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal"
    >
      {label}
    </Link>
  );
}
