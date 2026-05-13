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
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Companies
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Where your network works
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? "company" : "companies"}
          {params.q && ` matching "${params.q}"`}.
        </p>
      </header>

      <SearchInput basePath="/companies" q={params.q} placeholder="Filter by name…" />

      <section className="mt-8">
        {rows.length === 0 ? (
          <p data-testid="empty-list" className="text-sm text-muted-foreground">
            No companies match this filter.
          </p>
        ) : (
          <ul
            data-testid="companies-list"
            className="divide-y divide-border rounded-md border border-border"
          >
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <Link
                  href={`/companies/${r.id}`}
                  className="-mx-4 flex items-baseline justify-between gap-3 px-4 py-1 rounded hover:bg-muted/40"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.peopleCount} {r.peopleCount === 1 ? "person" : "people"}
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
    </main>
  );
}
