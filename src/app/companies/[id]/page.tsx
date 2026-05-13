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
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/companies" className="hover:underline">
            Companies
          </Link>
        </p>
        <h1 data-testid="company-name" className="mt-2 text-3xl font-semibold tracking-tight">
          {company.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {people.length} {people.length === 1 ? "position" : "positions"} from
          your network ({current.length} current)
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          People in your network
        </h2>
        <ul data-testid="company-people" className="mt-4 divide-y divide-border rounded-md border border-border">
          {people.map((p, i) => (
            <li
              key={`${p.id}-${i}`}
              data-origin={p.origin}
              className="px-4 py-3 text-sm"
            >
              <Link
                href={`/people/${p.id}`}
                className="block -mx-4 rounded px-4 py-1 hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.fullName}</span>
                  {p.current && (
                    <span className="rounded-sm bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Current
                    </span>
                  )}
                </div>
                {p.title && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.title}
                  </p>
                )}
                {p.origin === "synthesised" ? (
                  <p className="mt-0.5 text-xs text-muted-foreground italic">
                    from network metadata
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.startDate ?? "(unknown)"} –{" "}
                    {p.current ? "present" : (p.endDate ?? "(unknown)")}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" data-testid="derived-pairs-section">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Overlaps at this company{" "}
          <span className="ml-1 normal-case text-muted-foreground/70">
            (inferred — never asserted)
          </span>
        </h2>
        {derivedPairs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No derived overlaps surfaced yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {derivedPairs.map((p) => (
              <li
                key={`${p.personAId}-${p.personBId}`}
                data-testid="derived-pair-row"
                className="px-4 py-3 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">
                    <Link href={`/people/${p.personAId}`} className="hover:underline">
                      {p.personAName}
                    </Link>
                    {" ↔ "}
                    <Link href={`/people/${p.personBId}`} className="hover:underline">
                      {p.personBName}
                    </Link>
                  </p>
                  <span
                    className="rounded-sm bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300"
                    title={`confidence ${p.confidence}`}
                  >
                    {confidenceLabel(p.confidence)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
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
    </main>
  );
}
