import Link from "next/link";
import { listPeople } from "@/lib/queries/people";
import { parsePageParams } from "@/lib/pagination";
import { PageNav } from "@/components/page-nav";
import { SearchInput } from "@/components/search-input";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parsePageParams(searchParams);
  const { rows, total, totalPages, hasNext, hasPrev } = await listPeople(params);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          People
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Your network
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? "person" : "people"} in your
          first-degree network
          {params.q && ` matching "${params.q}"`}.
        </p>
      </header>

      <SearchInput basePath="/people" q={params.q} placeholder="Filter by name…" />

      <section className="mt-8">
        {rows.length === 0 ? (
          <p data-testid="empty-list" className="text-sm text-muted-foreground">
            No people match this filter.
          </p>
        ) : (
          <ul
            data-testid="people-list"
            className="divide-y divide-border rounded-md border border-border"
          >
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <Link
                  href={`/people/${r.id}`}
                  className="block hover:bg-muted/40 -mx-4 px-4 py-1 rounded"
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
        <PageNav
          basePath="/people"
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
