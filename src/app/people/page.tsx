import Link from "next/link";
import { coerceSort, listPeople } from "@/lib/queries/people";
import { formatDateYMD } from "@/lib/queries/messages";
import { parsePageParams } from "@/lib/pagination";
import { PageNav } from "@/components/page-nav";
import { SearchInput } from "@/components/search-input";

export const dynamic = "force-dynamic";

function rawString(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function SortLink({
  currentSort,
  targetSort,
  q,
  label,
}: {
  currentSort: "name" | "last_contact";
  targetSort: "name" | "last_contact";
  q: string;
  label: string;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  // Default (name) omits the sort param so the URL stays clean and Back
  // returns to the canonical alphabetical view.
  if (targetSort !== "name") params.set("sort", targetSort);
  const qs = params.toString();
  const href = qs ? `/people?${qs}` : "/people";
  const active = currentSort === targetSort;
  return (
    <Link
      href={href}
      data-active={active ? "true" : "false"}
      className={
        active
          ? "rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 text-accent-signal"
          : "rounded-sm border border-border-subtle bg-overlay px-2 py-0.5 text-text-secondary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal"
      }
    >
      {label}
    </Link>
  );
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parsePageParams(searchParams);
  const sort = coerceSort(rawString(searchParams.sort));
  const { rows, total, totalPages, hasNext, hasPrev } = await listPeople(
    params,
    sort,
  );

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

        <nav
          data-testid="people-sort"
          className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-text-tertiary"
        >
          <span>Sort</span>
          <SortLink
            currentSort={sort}
            targetSort="name"
            q={params.q}
            label="A–Z"
          />
          <SortLink
            currentSort={sort}
            targetSort="last_contact"
            q={params.q}
            label="Last contact"
          />
        </nav>

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
                    <div className="mt-0.5 flex items-baseline gap-3 font-mono text-[10px] text-text-tertiary">
                      {r.connectedAt && (
                        <span>connected {r.connectedAt}</span>
                      )}
                      {r.lastContactAt && (
                        <span data-testid="people-last-contact">
                          last contact {formatDateYMD(r.lastContactAt)}
                        </span>
                      )}
                    </div>
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
            sort={sort === "name" ? undefined : sort}
          />
        </section>
      </div>
    </div>
  );
}
