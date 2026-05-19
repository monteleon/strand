import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompanyById } from "@/lib/queries/companies";
import {
  confidenceLabel,
  listDerivedPairsAtCompany,
} from "@/lib/queries/derivedEdges";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getCompanyById(params.id);
  if (!data) notFound();
  const { company, people } = data;
  const current = people.filter((p) => p.current);
  const derivedPairs = await listDerivedPairsAtCompany(company.id);

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/companies"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              Companies
            </Link>
          </p>
          <h1
            data-testid="company-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {company.name}
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            <span className="font-mono text-text-primary">{people.length}</span>{" "}
            {people.length === 1 ? "position" : "positions"} from your network
            (
            <span className="font-mono text-text-primary">
              {current.length}
            </span>{" "}
            current)
          </p>
        </header>

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            People in your network
          </h2>
          <ul
            data-testid="company-people"
            className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
          >
            {people.map((p, i) => (
              <li
                key={`${p.id}-${i}`}
                data-origin={p.origin}
                className="text-sm"
              >
                <Link
                  href={`/people/${p.id}`}
                  className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-text-primary">
                      {p.fullName}
                    </span>
                    {p.current && (
                      <span className="rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal">
                        Current
                      </span>
                    )}
                  </div>
                  {p.title && (
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {p.title}
                    </p>
                  )}
                  {p.origin === "synthesised" ? (
                    <p className="mt-0.5 text-xs italic text-text-tertiary">
                      from network metadata
                    </p>
                  ) : (
                    <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                      {p.startDate ?? "(unknown)"} –{" "}
                      {p.current ? "present" : (p.endDate ?? "(unknown)")}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" data-testid="derived-pairs-section">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Overlaps at this company{" "}
            <span className="ml-1 normal-case text-text-tertiary">
              (inferred — never asserted)
            </span>
          </h2>
          {derivedPairs.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No derived overlaps surfaced yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">
              {derivedPairs.map((p) => (
                <li
                  key={`${p.personAId}-${p.personBId}`}
                  data-testid="derived-pair-row"
                  className="px-4 py-2.5 text-sm"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-text-primary">
                      <Link
                        href={`/people/${p.personAId}`}
                        className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
                      >
                        {p.personAName}
                      </Link>
                      <span className="mx-1 text-text-tertiary">↔</span>
                      <Link
                        href={`/people/${p.personBId}`}
                        className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
                      >
                        {p.personBName}
                      </Link>
                    </p>
                    <span
                      className="rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal"
                      title={`confidence ${p.confidence}`}
                    >
                      {confidenceLabel(p.confidence)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {p.overlapMonths > 0
                      ? `${p.overlapMonths} months overlap`
                      : p.bothCurrent
                        ? "both currently there"
                        : "same employer, no overlap window"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
