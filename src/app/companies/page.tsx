import Link from "next/link";
import { listCompanies } from "@/lib/queries/companies";
import { parsePageParams } from "@/lib/pagination";
import { PageNav } from "@/components/page-nav";
import { SearchInput } from "@/components/search-input";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parsePageParams(searchParams);
  const { rows, total, totalPages, hasNext, hasPrev } = await listCompanies(params);

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Companies
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Where your network works
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono">{total.toLocaleString()}</span>{" "}
            {total === 1 ? "company" : "companies"}
            {params.q && (
              <>
                {" "}
                matching{" "}
                <span className="font-mono text-text-primary">
                  &ldquo;{params.q}&rdquo;
                </span>
              </>
            )}
            .
          </p>
        </header>

        <SearchInput
          basePath="/companies"
          q={params.q}
          placeholder="Filter by name…"
        />

        <section className="mt-6">
          {rows.length === 0 ? (
            <p
              data-testid="empty-list"
              className="text-sm text-text-secondary"
            >
              No companies match this filter.
            </p>
          ) : (
            <ul
              data-testid="companies-list"
              className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {rows.map((r) => (
                <li key={r.id} className="text-sm">
                  <Link
                    href={`/companies/${r.id}`}
                    className="flex items-baseline justify-between gap-3 px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <span className="font-medium text-text-primary">
                      {r.name}
                    </span>
                    <span className="font-mono text-xs text-text-secondary">
                      {r.peopleCount}{" "}
                      {r.peopleCount === 1 ? "person" : "people"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <PageNav
            basePath="/companies"
            page={params.page}
            totalPages={totalPages}
            q={params.q}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
        </section>
      </div>
    </div>
  );
}
