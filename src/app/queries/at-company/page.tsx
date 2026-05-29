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
import { parsePageParams } from "@/lib/pagination";
import { SaveBookmark } from "@/components/save-bookmark";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";
import { PageNav } from "@/components/page-nav";

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

  if (!companyId) {
    const { rows } = await listCompanies({ page: 1, q });
    const topRows = rows.slice(0, 20);
    return (
      <div className="min-h-screen bg-canvas text-text-primary">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <header className="border-b border-border-subtle pb-6">
            <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
              Queries
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Who do I know at…
            </h1>
            <p className="mt-3 text-sm text-text-secondary">
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
              className="flex-1 rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
              autoComplete="off"
            />
            <button
              type="submit"
              className="rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:bg-surface"
            >
              Filter
            </button>
            {q && (
              <a
                href="/queries/at-company"
                className="font-mono text-xs text-text-secondary underline decoration-text-tertiary underline-offset-4 transition-colors duration-fast ease-cubic-out hover:text-accent-signal hover:decoration-accent-signal"
              >
                clear
              </a>
            )}
          </form>

          <section className="mt-6">
            {topRows.length === 0 ? (
              <p
                data-testid="empty-picker"
                className="text-sm text-text-secondary"
              >
                No companies match this filter.
              </p>
            ) : (
              <ul
                data-testid="company-picker"
                className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
              >
                {topRows.map((c) => (
                  <li key={c.id} className="text-sm">
                    <Link
                      href={buildUrl({ company: c.id, status, sort })}
                      className="flex items-baseline justify-between gap-3 px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                    >
                      <span className="font-medium text-text-primary">
                        {c.name}
                      </span>
                      <span className="font-mono text-xs text-text-secondary">
                        {c.peopleCount}{" "}
                        {c.peopleCount === 1 ? "person" : "people"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <SavedQueriesSidebar bookmarks={bookmarks} />
        </div>
      </div>
    );
  }

  const data = await getCompanyById(companyId);
  if (!data) notFound();
  const page = parsePageParams(searchParams).page;
  const { rows, total, totalPages, hasNext, hasPrev } = await listAtCompany(
    companyId,
    status,
    sort,
    page,
  );
  const url = buildUrl({ company: companyId, status, sort });

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/queries/at-company"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              Queries · Who do I know at…
            </Link>
          </p>
          <h1
            data-testid="at-company-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {data.company.name}
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono text-text-primary">{total}</span>{" "}
            {total === 1 ? "position" : "positions"} from your network
            {status === "current" && " (currently active)"}
            {status === "past" && " (past)"}.
          </p>
        </header>

        <section className="mt-6 flex flex-wrap items-center gap-2">
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
          <span className="mx-1 font-mono text-xs text-text-tertiary">·</span>
          <FilterChip
            label="Declared first"
            href={buildUrl({
              company: companyId,
              status,
              sort: "declared-first",
            })}
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

        <section className="mt-6">
          {rows.length === 0 ? (
            <p
              data-testid="empty-list"
              className="text-sm text-text-secondary"
            >
              No positions match this filter.
            </p>
          ) : (
            <ul
              data-testid="at-company-list"
              className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {rows.map((r, i) => (
                <li
                  key={`${r.id}-${i}`}
                  data-origin={r.origin}
                  className="text-sm"
                >
                  <Link
                    href={`/people/${r.id}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-text-primary">
                        {r.fullName}
                      </span>
                      {r.current && (
                        <span className="rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal">
                          Current
                        </span>
                      )}
                    </div>
                    {r.title && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {r.title}
                      </p>
                    )}
                    {r.origin === "synthesised" ? (
                      <p className="mt-0.5 text-xs italic text-text-tertiary">
                        from network metadata
                      </p>
                    ) : (
                      <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                        {r.startDate ?? "(unknown)"} –{" "}
                        {r.current ? "present" : (r.endDate ?? "(unknown)")}
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
          <PageNav
            basePath="/queries/at-company"
            page={page}
            totalPages={totalPages}
            q=""
            hasPrev={hasPrev}
            hasNext={hasNext}
            extraParams={{
              company: companyId,
              status: status !== "any" ? status : undefined,
              sort: sort !== "declared-first" ? sort : undefined,
            }}
          />
        </section>

        <section className="mt-6">
          <SaveBookmark url={url} />
        </section>

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
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
        "rounded-sm border px-2.5 py-1 font-mono text-xs transition-colors duration-fast ease-cubic-out " +
        (active
          ? "border-accent-signal/40 bg-accent-signal/10 text-accent-signal"
          : "border-border-subtle bg-overlay text-text-secondary hover:border-border-strong hover:text-text-primary")
      }
    >
      {label}
    </Link>
  );
}
