import Link from "next/link";
import {
  listConnectionYears,
  listPeopleByYear,
} from "@/lib/queries/people";
import { listSavedQueries } from "@/lib/queries/savedQueries";
import { SaveBookmark } from "@/components/save-bookmark";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

function single(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function ByYearPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const yearParam = single(searchParams.year).trim();
  const buckets = await listConnectionYears();
  const bookmarks = await listSavedQueries();

  if (!yearParam) {
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return (
      <div className="min-h-screen bg-canvas text-text-primary">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <header className="border-b border-border-subtle pb-6">
            <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
              Queries
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Connections by year
            </h1>
            <p className="mt-3 text-sm text-text-secondary">
              <span className="font-mono">{total.toLocaleString()}</span>{" "}
              connections across{" "}
              <span className="font-mono">{buckets.length}</span>{" "}
              {buckets.length === 1 ? "bucket" : "buckets"}. Click a year to
              see who you connected with in that cohort.
            </p>
          </header>

          <section className="mt-6" data-testid="by-year-histogram">
            {buckets.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No connections in this tenant.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">
                {buckets.map((b) => {
                  const width = Math.max(
                    2,
                    Math.round((b.count / max) * 100),
                  );
                  return (
                    <li
                      key={b.year}
                      data-testid="by-year-bucket"
                      className="text-sm"
                    >
                      <Link
                        href={`/queries/by-year?year=${encodeURIComponent(b.year)}`}
                        className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-text-primary">
                            {b.year === "unknown" ? "Unknown year" : b.year}
                          </span>
                          <span className="font-mono text-xs text-text-secondary">
                            {b.count.toLocaleString()}{" "}
                            {b.count === 1 ? "person" : "people"}
                          </span>
                        </div>
                        <div
                          className="mt-2 h-1.5 rounded-sm bg-accent-signal/30"
                          style={{ width: `${width}%` }}
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <SavedQueriesSidebar bookmarks={bookmarks} />
        </div>
      </div>
    );
  }

  const rows = await listPeopleByYear(yearParam);
  const url = `/queries/by-year?year=${encodeURIComponent(yearParam)}`;
  const label = yearParam === "unknown" ? "Unknown year" : yearParam;

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/queries/by-year"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              Queries · Connections by year
            </Link>
          </p>
          <h1
            data-testid="by-year-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {label}
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono">{rows.length.toLocaleString()}</span>{" "}
            {rows.length === 1 ? "person" : "people"} connected in this cohort.
          </p>
        </header>

        <section className="mt-6">
          {rows.length === 0 ? (
            <p
              data-testid="by-year-empty"
              className="text-sm text-text-secondary"
            >
              No people connected this year.
            </p>
          ) : (
            <ul
              data-testid="by-year-list"
              className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {rows.map((r) => (
                <li
                  key={r.id}
                  data-testid="by-year-row"
                  className="text-sm"
                >
                  <Link
                    href={`/people/${r.id}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <p className="font-medium text-text-primary">
                      {r.fullName}
                    </p>
                    {r.headline && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {r.headline}
                      </p>
                    )}
                    {r.connectedAt && (
                      <p className="mt-0.5 font-mono text-[10px] text-text-tertiary">
                        connected {r.connectedAt}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <SaveBookmark url={url} />
        </section>

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
  );
}
