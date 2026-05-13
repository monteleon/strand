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

  // No year selected: render the histogram.
  if (!yearParam) {
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="border-b border-border pb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Queries
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Connections by year
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {total.toLocaleString()} connections across {buckets.length}{" "}
            {buckets.length === 1 ? "bucket" : "buckets"}. Click a year to
            see who you connected with in that cohort.
          </p>
        </header>

        <section className="mt-8" data-testid="by-year-histogram">
          {buckets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connections in this tenant.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {buckets.map((b) => {
                const width = Math.max(2, Math.round((b.count / max) * 100));
                return (
                  <li
                    key={b.year}
                    data-testid="by-year-bucket"
                    className="px-4 py-3 text-sm"
                  >
                    <Link
                      href={`/queries/by-year?year=${encodeURIComponent(b.year)}`}
                      className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">
                          {b.year === "unknown" ? "Unknown year" : b.year}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {b.count.toLocaleString()}{" "}
                          {b.count === 1 ? "person" : "people"}
                        </span>
                      </div>
                      <div
                        className="mt-2 h-1.5 rounded-sm bg-foreground/15"
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
      </main>
    );
  }

  // Year selected: drilldown.
  const rows = await listPeopleByYear(yearParam);
  const url = `/queries/by-year?year=${encodeURIComponent(yearParam)}`;
  const label = yearParam === "unknown" ? "Unknown year" : yearParam;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/queries/by-year" className="hover:underline">
            Queries · Connections by year
          </Link>
        </p>
        <h1
          data-testid="by-year-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {label}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {rows.length.toLocaleString()}{" "}
          {rows.length === 1 ? "person" : "people"} connected in this cohort.
        </p>
      </header>

      <section className="mt-8">
        {rows.length === 0 ? (
          <p
            data-testid="by-year-empty"
            className="text-sm text-muted-foreground"
          >
            No people connected this year.
          </p>
        ) : (
          <ul
            data-testid="by-year-list"
            className="divide-y divide-border rounded-md border border-border"
          >
            {rows.map((r) => (
              <li
                key={r.id}
                data-testid="by-year-row"
                className="px-4 py-3 text-sm"
              >
                <Link
                  href={`/people/${r.id}`}
                  className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                >
                  <p className="font-medium">{r.fullName}</p>
                  {r.headline && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.headline}
                    </p>
                  )}
                  {r.connectedAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      connected {r.connectedAt}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <SaveBookmark url={url} />
      </section>

      <SavedQueriesSidebar bookmarks={bookmarks} />
    </main>
  );
}
