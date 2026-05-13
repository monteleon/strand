import Link from "next/link";
import { notFound } from "next/navigation";
import { findReachToPerson } from "@/lib/queries/reach";
import { confidenceLabel } from "@/lib/queries/derivedEdges";
import { listSavedQueries } from "@/lib/queries/savedQueries";
import { SaveBookmark } from "@/components/save-bookmark";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function ReachDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const result = await findReachToPerson(params.id);
  if (!result) notFound();
  const bookmarks = await listSavedQueries();
  const url = `/queries/reach/${result.target.id}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/queries/reach" className="hover:underline">
            Queries · Strongest reach to…
          </Link>
        </p>
        <h1
          data-testid="reach-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {result.target.fullName}
        </h1>
        {result.target.headline && (
          <p className="mt-3 text-base text-muted-foreground">
            {result.target.headline}
          </p>
        )}
      </header>

      {result.status.kind === "self" ? (
        <section
          className="mt-10 rounded-md border border-border bg-muted/10 p-6"
          data-testid="reach-self"
        >
          <p className="text-sm font-medium">This is you.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The reach query is for finding intermediaries to someone else in
            your network.
          </p>
        </section>
      ) : (
        <>
          {result.status.directConnection && (
            <section
              className="mt-8 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4"
              data-testid="reach-direct"
            >
              <p className="text-sm font-medium">
                You&rsquo;re directly connected.
              </p>
              {result.status.directConnection.connectedAt && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  connected {result.status.directConnection.connectedAt}
                </p>
              )}
            </section>
          )}

          <section className="mt-8" data-testid="reach-candidates-section">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
              Strongest reach
            </h2>
            {result.status.candidates.length === 0 ? (
              <p
                data-testid="reach-empty"
                className="mt-3 text-sm text-muted-foreground"
              >
                {result.status.directConnection
                  ? "No mutuals identified — you reach this person directly only."
                  : "No path found through your network."}
              </p>
            ) : (
              <ul
                data-testid="reach-list"
                className="mt-4 divide-y divide-border rounded-md border border-border"
              >
                {result.status.candidates.map((c) => (
                  <li
                    key={c.intermediaryId}
                    data-testid="reach-row"
                    data-via={c.via}
                    className="px-4 py-3 text-sm"
                  >
                    <Link
                      href={`/people/${c.intermediaryId}`}
                      className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{c.intermediaryName}</span>
                        <span
                          className={
                            c.via === "manual"
                              ? "rounded-sm bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300"
                              : "rounded-sm bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300"
                          }
                          title={`score ${c.score}`}
                        >
                          {c.via === "manual" ? "Manual" : confidenceLabel(c.score)}
                        </span>
                      </div>
                      {c.intermediaryHeadline && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {c.intermediaryHeadline}
                        </p>
                      )}
                      {c.via === "manual" ? (
                        c.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground italic">
                            “{c.note}”
                          </p>
                        )
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {c.companyName ?? "(unknown company)"}
                          {c.overlapMonths && c.overlapMonths > 0
                            ? ` · ${c.overlapMonths} months overlap`
                            : c.bothCurrent
                              ? " · both currently there"
                              : " · same employer, no overlap window"}
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
        </>
      )}

      <SavedQueriesSidebar bookmarks={bookmarks} />
    </main>
  );
}
