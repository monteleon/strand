import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonById } from "@/lib/queries/people";
import { listManualEdgesForPerson } from "@/lib/queries/manualEdges";
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
  const manualEdges = await listManualEdgesForPerson(person.id);

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
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.startDate ?? "(unknown)"} –{" "}
                  {p.current ? "present" : (p.endDate ?? "(unknown)")}
                </p>
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
    </main>
  );
}
