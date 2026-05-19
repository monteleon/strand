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
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            People
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Your network
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono">{total.toLocaleString()}</span>{" "}
            {total === 1 ? "person" : "people"} in your first-degree network
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

        <SearchInput basePath="/people" q={params.q} placeholder="Filter by name…" />

        <section className="mt-6">
          {rows.length === 0 ? (
            <p
              data-testid="empty-list"
              className="text-sm text-text-secondary"
            >
              No people match this filter.
            </p>
          ) : (
            <ul
              data-testid="people-list"
              className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {rows.map((r) => (
                <li key={r.id} className="text-sm">
                  <Link
                    href={`/people/${r.id}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <p className="font-medium text-text-primary">{r.fullName}</p>
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
          <PageNav
            basePath="/people"
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
