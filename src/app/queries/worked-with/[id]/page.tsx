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
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/queries/worked-with"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              Queries · Who has worked with…
            </Link>
          </p>
          <h1
            data-testid="worked-with-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {person.fullName}
          </h1>
          {person.headline && (
            <p className="mt-3 text-base text-text-secondary">
              {person.headline}
            </p>
          )}
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono text-text-primary">
              {manualEdges.length}
            </span>{" "}
            manual ·{" "}
            <span className="font-mono text-text-primary">
              {derivedEdges.length}
            </span>{" "}
            derived
          </p>
        </header>

        <section className="mt-6" data-testid="worked-with-manual-section">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Manual connections
          </h2>
          {manualEdges.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No manually-asserted connections to this person.
            </p>
          ) : (
            <ul
              data-testid="worked-with-manual-list"
              className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {manualEdges.map((m) => (
                <li
                  key={m.otherPersonId}
                  data-testid="worked-with-manual-row"
                  className="text-sm"
                >
                  <Link
                    href={`/people/${m.otherPersonId}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <p className="font-medium text-text-primary">
                      {m.otherPersonName}
                    </p>
                    {m.note && (
                      <p className="mt-0.5 text-xs italic text-text-tertiary">
                        &ldquo;{m.note}&rdquo;
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6" data-testid="worked-with-derived-section">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Derived connections{" "}
            <span className="ml-1 normal-case text-text-tertiary">
              (inferred from shared employers — never asserted)
            </span>
          </h2>
          {derivedEdges.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No derived connections — run the derive job or check ingest.
            </p>
          ) : (
            <ul
              data-testid="worked-with-derived-list"
              className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {derivedEdges.map((e) => (
                <li
                  key={`${e.otherPersonId}-${e.companyId}-${e.kind}`}
                  data-testid="worked-with-derived-row"
                  className="text-sm"
                >
                  <Link
                    href={`/people/${e.otherPersonId}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-text-primary">
                        {e.otherPersonName}
                      </span>
                      <span
                        className="rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal"
                        title={`confidence ${e.confidence}`}
                      >
                        {confidenceLabel(e.confidence)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
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

        <section className="mt-6">
          <SaveBookmark url={url} />
        </section>

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
  );
}
