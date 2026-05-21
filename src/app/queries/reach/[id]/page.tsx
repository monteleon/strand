import Link from "next/link";
import { notFound } from "next/navigation";
import { findReachToPerson, parseReachSort } from "@/lib/queries/reach";
import { confidenceLabel } from "@/lib/queries/derivedEdges";
import { listSavedQueries } from "@/lib/queries/savedQueries";
import { formatDateYMD } from "@/lib/queries/messages";
import { SaveBookmark } from "@/components/save-bookmark";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function ReachDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { sort?: string | string[] };
}) {
  const sort = parseReachSort(searchParams?.sort);
  const result = await findReachToPerson(params.id, "local", sort);
  if (!result) notFound();
  const bookmarks = await listSavedQueries();
  // ISC-283 / ISC-297: bookmark URL preserves the sort param so the saved
  // query round-trips with the user's ranking choice intact.
  const url =
    sort === "warmth"
      ? `/queries/reach/${result.target.id}?sort=warmth`
      : `/queries/reach/${result.target.id}`;

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/queries/reach"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              Queries · Strongest reach to…
            </Link>
          </p>
          <h1
            data-testid="reach-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {result.target.fullName}
          </h1>
          {result.target.headline && (
            <p className="mt-3 text-base text-text-secondary">
              {result.target.headline}
            </p>
          )}
        </header>

        {result.status.kind === "self" ? (
          <section
            className="mt-8 rounded-md border border-accent-warmth/40 bg-accent-warmth/5 p-6"
            data-testid="reach-self"
          >
            <p className="font-medium text-text-primary">This is you.</p>
            <p className="mt-1 text-xs text-text-secondary">
              The reach query is for finding intermediaries to someone else in
              your network.
            </p>
          </section>
        ) : (
          <>
            {result.status.directConnection && (
              <section
                className="mt-6 rounded-md border border-accent-signal/40 bg-accent-signal/5 px-4 py-3"
                data-testid="reach-direct"
              >
                <p className="font-medium text-text-primary">
                  You&rsquo;re directly connected.
                </p>
                {result.status.directConnection.connectedAt && (
                  <p className="mt-0.5 font-mono text-xs text-text-secondary">
                    connected {result.status.directConnection.connectedAt}
                  </p>
                )}
              </section>
            )}

            <section className="mt-6" data-testid="reach-candidates-section">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
                  {sort === "warmth" ? "Warmest reach" : "Strongest reach"}
                </h2>
                <div
                  data-testid="reach-sort-toggle"
                  className="flex items-center gap-1 rounded-sm border border-border-subtle bg-surface p-0.5 font-mono text-[10px] uppercase tracking-wide"
                >
                  <Link
                    href={`/queries/reach/${result.target.id}`}
                    data-testid="reach-sort-epistemic"
                    aria-pressed={sort === "epistemic"}
                    className={
                      sort === "epistemic"
                        ? "rounded-sm bg-accent-signal/15 px-2 py-0.5 text-accent-signal"
                        : "rounded-sm px-2 py-0.5 text-text-tertiary transition-colors duration-fast ease-cubic-out hover:text-text-secondary"
                    }
                  >
                    Epistemic
                  </Link>
                  <Link
                    href={`/queries/reach/${result.target.id}?sort=warmth`}
                    data-testid="reach-sort-warmth"
                    aria-pressed={sort === "warmth"}
                    className={
                      sort === "warmth"
                        ? "rounded-sm bg-accent-warmth/15 px-2 py-0.5 text-accent-warmth"
                        : "rounded-sm px-2 py-0.5 text-text-tertiary transition-colors duration-fast ease-cubic-out hover:text-text-secondary"
                    }
                  >
                    Warmth
                  </Link>
                </div>
              </div>
              {result.status.candidates.length === 0 ? (
                <p
                  data-testid="reach-empty"
                  className="mt-3 text-sm text-text-secondary"
                >
                  {result.status.directConnection
                    ? "No mutuals identified — you reach this person directly only."
                    : "No path found through your network."}
                </p>
              ) : (
                <ul
                  data-testid="reach-list"
                  className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
                >
                  {result.status.candidates.map((c) => (
                    <li
                      key={c.intermediaryId}
                      data-testid="reach-row"
                      data-via={c.via}
                      className="text-sm"
                    >
                      <Link
                        href={`/people/${c.intermediaryId}`}
                        className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-text-primary">
                            {c.intermediaryName}
                          </span>
                          <span
                            className={
                              c.via === "manual"
                                ? "rounded-sm border border-accent-warmth/30 bg-accent-warmth/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-warmth"
                                : "rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal"
                            }
                            title={`score ${c.score}`}
                          >
                            {c.via === "manual"
                              ? "Manual"
                              : confidenceLabel(c.score)}
                          </span>
                        </div>
                        {c.intermediaryHeadline && (
                          <p className="mt-0.5 text-xs text-text-secondary">
                            {c.intermediaryHeadline}
                          </p>
                        )}
                        {c.via === "manual" ? (
                          c.note && (
                            <p className="mt-0.5 text-xs italic text-text-tertiary">
                              &ldquo;{c.note}&rdquo;
                            </p>
                          )
                        ) : (
                          <p className="mt-0.5 text-xs text-text-secondary">
                            {c.companyName ?? "(unknown company)"}
                            {c.overlapMonths && c.overlapMonths > 0
                              ? ` · ${c.overlapMonths} months overlap`
                              : c.bothCurrent
                                ? " · both currently there"
                                : " · same employer, no overlap window"}
                          </p>
                        )}
                        <p
                          data-testid="reach-warmth"
                          data-warmth-total={c.messages.total}
                          className="mt-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary"
                        >
                          {c.messages.total > 0
                            ? `${c.messages.total} msgs${
                                c.messages.lastAt
                                  ? ` · last ${formatDateYMD(c.messages.lastAt)}`
                                  : ""
                              }`
                            : "—"}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6">
              <SaveBookmark url={url} />
            </section>
          </>
        )}

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
  );
}
