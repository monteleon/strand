import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonById } from "@/lib/queries/people";
import { listManualEdgesForPerson } from "@/lib/queries/manualEdges";
import {
  confidenceLabel,
  listDerivedEdgesForPerson,
} from "@/lib/queries/derivedEdges";
import { AddConnection } from "@/components/add-connection";
import { ManualEdges } from "./manual-edges";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPersonById(params.id);
  if (!data) notFound();
  const { person, positions, connectedAt } = data;
  // Two query calls — the manual and derived edge lists travel through
  // separate functions on purpose (ISC-94: different epistemics, never
  // co-mingled at the read layer).
  const manualEdges = await listManualEdgesForPerson(person.id);
  const derivedEdges = await listDerivedEdgesForPerson(person.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          <Link href="/people" className="hover:underline">
            People
          </Link>
        </p>
        <h1
          data-testid="person-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {person.fullName}
        </h1>
        {person.headline && (
          <p className="mt-3 text-base text-muted-foreground">{person.headline}</p>
        )}
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
          {person.email && (
            <div>
              <dt className="uppercase tracking-wider">Email</dt>
              <dd className="mt-0.5 text-foreground">{person.email}</dd>
            </div>
          )}
          {person.linkedinUrl && (
            <div>
              <dt className="uppercase tracking-wider">LinkedIn</dt>
              <dd className="mt-0.5 text-foreground truncate">
                <a
                  href={person.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  profile
                </a>
              </dd>
            </div>
          )}
          {connectedAt && (
            <div>
              <dt className="uppercase tracking-wider">Connected</dt>
              <dd className="mt-0.5 text-foreground">{connectedAt}</dd>
            </div>
          )}
        </dl>
      </header>

      {positions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Positions
          </h2>
          <ul data-testid="positions-list" className="mt-4 space-y-2 text-sm">
            {positions.map((p) => (
              <li
                key={p.id}
                data-origin={p.origin}
                className="rounded-md border border-border bg-muted/10 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{p.title ?? "(no title)"}</p>
                  {p.companyId && p.companyName && (
                    <Link
                      href={`/companies/${p.companyId}`}
                      className="text-xs text-muted-foreground underline underline-offset-4"
                    >
                      {p.companyName}
                    </Link>
                  )}
                </div>
                {p.origin === "synthesised" ? (
                  <p
                    data-testid="position-synthesised"
                    className="mt-0.5 text-xs text-muted-foreground italic"
                  >
                    currently at this company (from network metadata; dates unknown)
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.startDate ?? "(unknown)"} –{" "}
                    {p.current ? "present" : (p.endDate ?? "(unknown)")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Manual connections
        </h2>
        <ManualEdges personId={person.id} edges={manualEdges} />
        <AddConnection personId={person.id} />
      </section>

      <section className="mt-10" data-testid="derived-edges-section">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Derived connections{" "}
          <span className="ml-1 normal-case text-muted-foreground/70">
            (inferred from shared employers — never asserted)
          </span>
        </h2>
        {derivedEdges.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No derived connections yet — run the derive job or import a
            LinkedIn export first.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {derivedEdges.map((e) => (
              <li
                key={`${e.otherPersonId}-${e.companyId}-${e.kind}`}
                data-testid="derived-edge-row"
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
    </main>
  );
}
