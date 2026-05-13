import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonById } from "@/lib/queries/people";
import { listManualEdgesForPerson } from "@/lib/queries/manualEdges";
import {
  confidenceLabel,
  listDerivedEdgesForPerson,
} from "@/lib/queries/derivedEdges";
import { listSavedQueries } from "@/lib/queries/savedQueries";
import { SaveBookmark } from "@/components/save-bookmark";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function WorkedWithDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPersonById(params.id);
  if (!data) notFound();
  const { person } = data;

  // Two query calls, two separate modules — ISC-94 / ISC-122 epistemic
  // separation. Surface limits intentionally larger here than the
  // person-detail page because this is a query, not a profile widget.
  const [manualEdges, derivedEdges, bookmarks] = await Promise.all([
    listManualEdgesForPerson(person.id),
    listDerivedEdgesForPerson(person.id, undefined, 200),
    listSavedQueries(),
  ]);

  const url = `/queries/worked-with/${person.id}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/queries/worked-with" className="hover:underline">
            Queries · Who has worked with…
          </Link>
        </p>
        <h1
          data-testid="worked-with-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {person.fullName}
        </h1>
        {person.headline && (
          <p className="mt-3 text-base text-muted-foreground">{person.headline}</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {manualEdges.length} manual ·{" "}
          {derivedEdges.length} derived
        </p>
      </header>

      <section
        className="mt-10"
        data-testid="worked-with-manual-section"
      >
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Manual connections
        </h2>
        {manualEdges.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No manually-asserted connections to this person.
          </p>
        ) : (
          <ul
            data-testid="worked-with-manual-list"
            className="mt-4 divide-y divide-border rounded-md border border-border"
          >
            {manualEdges.map((m) => (
              <li
                key={m.otherPersonId}
                data-testid="worked-with-manual-row"
                className="px-4 py-3 text-sm"
              >
                <Link
                  href={`/people/${m.otherPersonId}`}
                  className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                >
                  <p className="font-medium">{m.otherPersonName}</p>
                  {m.note && (
                    <p className="mt-0.5 text-xs text-muted-foreground italic">
                      “{m.note}”
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="mt-10"
        data-testid="worked-with-derived-section"
      >
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Derived connections{" "}
          <span className="ml-1 normal-case text-muted-foreground/70">
            (inferred from shared employers — never asserted)
          </span>
        </h2>
        {derivedEdges.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No derived connections — run the derive job or check ingest.
          </p>
        ) : (
          <ul
            data-testid="worked-with-derived-list"
            className="mt-4 divide-y divide-border rounded-md border border-border"
          >
            {derivedEdges.map((e) => (
              <li
                key={`${e.otherPersonId}-${e.companyId}-${e.kind}`}
                data-testid="worked-with-derived-row"
                className="px-4 py-3 text-sm"
              >
                <Link
                  href={`/people/${e.otherPersonId}`}
                  className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{e.otherPersonName}</span>
                    <span
                      className="rounded-sm bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300"
                      title={`confidence ${e.confidence}`}
                    >
                      {confidenceLabel(e.confidence)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.companyName ?? "(unknown company)"}
                    {e.overlapMonths > 0
                      ? ` · ${e.overlapMonths} months overlap`
                      : e.bothCurrent
                        ? " · both currently there"
                        : " · same employer, no overlap window"}
                  </p>
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
