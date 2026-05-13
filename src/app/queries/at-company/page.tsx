import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCompanyById,
  listAtCompany,
  listCompanies,
  type AtCompanySort,
  type AtCompanyStatus,
} from "@/lib/queries/companies";
import { listSavedQueries } from "@/lib/queries/savedQueries";
import { SaveBookmark } from "@/components/save-bookmark";
import { DeleteBookmark } from "@/components/delete-bookmark";

export const dynamic = "force-dynamic";

const STATUSES = new Set<AtCompanyStatus>(["any", "current", "past"]);
const SORTS = new Set<AtCompanySort>(["declared-first", "name", "connected"]);

function normaliseStatus(raw: unknown): AtCompanyStatus {
  return typeof raw === "string" && STATUSES.has(raw as AtCompanyStatus)
    ? (raw as AtCompanyStatus)
    : "any";
}
function normaliseSort(raw: unknown): AtCompanySort {
  return typeof raw === "string" && SORTS.has(raw as AtCompanySort)
    ? (raw as AtCompanySort)
    : "declared-first";
}
function single(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function buildUrl(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const q = sp.toString();
  return q ? `/queries/at-company?${q}` : "/queries/at-company";
}

export default async function AtCompanyPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const companyId = single(searchParams.company).trim();
  const status = normaliseStatus(searchParams.status);
  const sort = normaliseSort(searchParams.sort);
  const q = single(searchParams.q).trim();

  const bookmarks = await listSavedQueries();

  // No company selected — show the picker (top companies by people count).
  if (!companyId) {
    const { rows } = await listCompanies({ page: 1, q });
    const topRows = rows.slice(0, 20);
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="border-b border-border pb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Queries
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Who do I know at…
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Pick a company to see everyone in your network with a position
            there. Filter by status (current / past) and sort to taste —
            then bookmark the resulting URL.
          </p>
        </header>

        <form
          data-testid="company-picker-form"
          action="/queries/at-company"
          method="get"
          className="mt-6 flex items-center gap-2"
        >
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Filter companies by name…"
            className="flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted/40"
          >
            Filter
          </button>
          {q && (
            <a
              href="/queries/at-company"
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              clear
            </a>
          )}
        </form>

        <section className="mt-8">
          {topRows.length === 0 ? (
            <p data-testid="empty-picker" className="text-sm text-muted-foreground">
              No companies match this filter.
            </p>
          ) : (
            <ul
              data-testid="company-picker"
              className="divide-y divide-border rounded-md border border-border"
            >
              {topRows.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <Link
                    href={buildUrl({ company: c.id, status, sort })}
                    className="flex items-baseline justify-between gap-3 hover:bg-muted/40 -mx-4 px-4 py-1 rounded"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.peopleCount}{" "}
                      {c.peopleCount === 1 ? "person" : "people"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <BookmarkSidebar bookmarks={bookmarks} />
      </main>
    );
  }

  // Company selected — fetch + render results.
  const data = await getCompanyById(companyId);
  if (!data) notFound();
  const rows = await listAtCompany(companyId, status, sort);
  const url = buildUrl({ company: companyId, status, sort });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/queries/at-company" className="hover:underline">
            Queries · Who do I know at…
          </Link>
        </p>
        <h1
          data-testid="at-company-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {data.company.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "position" : "positions"} from
          your network
          {status === "current" && " (currently active)"}
          {status === "past" && " (past)"}.
        </p>
      </header>

      <section className="mt-6 flex flex-wrap items-center gap-3">
        <FilterChip
          label="All"
          href={buildUrl({ company: companyId, status: "any", sort })}
          active={status === "any"}
        />
        <FilterChip
          label="Current only"
          href={buildUrl({ company: companyId, status: "current", sort })}
          active={status === "current"}
        />
        <FilterChip
          label="Past only"
          href={buildUrl({ company: companyId, status: "past", sort })}
          active={status === "past"}
        />
        <span className="text-xs text-muted-foreground">·</span>
        <FilterChip
          label="Declared first"
          href={buildUrl({ company: companyId, status, sort: "declared-first" })}
          active={sort === "declared-first"}
        />
        <FilterChip
          label="By name"
          href={buildUrl({ company: companyId, status, sort: "name" })}
          active={sort === "name"}
        />
        <FilterChip
          label="By connection date"
          href={buildUrl({ company: companyId, status, sort: "connected" })}
          active={sort === "connected"}
        />
      </section>

      <section className="mt-8">
        {rows.length === 0 ? (
          <p data-testid="empty-list" className="text-sm text-muted-foreground">
            No positions match this filter.
          </p>
        ) : (
          <ul
            data-testid="at-company-list"
            className="divide-y divide-border rounded-md border border-border"
          >
            {rows.map((r, i) => (
              <li
                key={`${r.id}-${i}`}
                data-origin={r.origin}
                className="px-4 py-3 text-sm"
              >
                <Link
                  href={`/people/${r.id}`}
                  className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{r.fullName}</span>
                    {r.current && (
                      <span className="rounded-sm bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        Current
                      </span>
                    )}
                  </div>
                  {r.title && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.title}
                    </p>
                  )}
                  {r.origin === "synthesised" ? (
                    <p className="mt-0.5 text-xs text-muted-foreground italic">
                      from network metadata
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.startDate ?? "(unknown)"} –{" "}
                      {r.current ? "present" : (r.endDate ?? "(unknown)")}
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

      <BookmarkSidebar bookmarks={bookmarks} />
    </main>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-testid={`chip-${label.replace(/\s+/g, "-").toLowerCase()}`}
      data-active={active ? "true" : "false"}
      className={
        "rounded-sm border px-2.5 py-1 text-xs hover:bg-muted/40 " +
        (active
          ? "border-foreground bg-foreground/5 font-medium"
          : "border-border text-muted-foreground")
      }
    >
      {label}
    </Link>
  );
}

function BookmarkSidebar({
  bookmarks,
}: {
  bookmarks: Awaited<ReturnType<typeof listSavedQueries>>;
}) {
  return (
    <section className="mt-12" data-testid="saved-queries-section">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
        Saved queries
      </h2>
      {bookmarks.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No saved queries yet. Bookmark this query (above) to save the
          current filter combination.
        </p>
      ) : (
        <ul
          data-testid="saved-queries-list"
          className="mt-4 divide-y divide-border rounded-md border border-border"
        >
          {bookmarks.map((b) => (
            <li
              key={b.id}
              data-testid="saved-query-row"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <Link
                href={b.url}
                className="block flex-1 truncate hover:underline"
              >
                {b.name}
              </Link>
              <DeleteBookmark id={b.id} name={b.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
