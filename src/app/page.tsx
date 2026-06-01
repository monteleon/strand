import nextDynamic from "next/dynamic";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";
import { assembleNetworkGraph } from "@/lib/queries/graph";
import { STRAND_VERSION_LABEL } from "@/lib/version";

export const dynamic = "force-dynamic";

// Hero graph touches `document`, ssr disabled.
const HeroGraph = nextDynamic(
  () => import("@/components/hero-graph").then((m) => m.HeroGraph),
  { ssr: false, loading: () => null },
);

async function getCounts() {
  const peopleCount = await db.$count(
    schema.people,
    eq(schema.people.tenantId, LOCAL_TENANT_ID),
  );
  const companiesCount = await db.$count(
    schema.companies,
    eq(schema.companies.tenantId, LOCAL_TENANT_ID),
  );
  return { peopleCount, companiesCount };
}

export default async function HomePage() {
  const { nodes, edges } = await assembleNetworkGraph();
  const { peopleCount, companiesCount } = await getCounts();
  const hasData = peopleCount > 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-text-primary">
      {hasData && nodes.length > 0 && (
        <>
          <HeroGraph nodes={nodes} edges={edges} />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-canvas/50 via-canvas/30 to-canvas/70"
            aria-hidden="true"
          />
        </>
      )}

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-8 py-16">
        <div className="rounded-lg border border-border-subtle bg-overlay/85 px-8 py-7 text-center shadow-2xl backdrop-blur-md">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            {STRAND_VERSION_LABEL}
          </p>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">
            Strand
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            Your professional network, your data. Self-hostable. Local-first.
          </p>
          {hasData ? (
            <p className="mt-4 font-mono text-xs text-text-secondary">
              <span className="text-text-primary">
                {peopleCount.toLocaleString()}
              </span>{" "}
              people ·{" "}
              <span className="text-text-primary">
                {companiesCount.toLocaleString()}
              </span>{" "}
              companies ·{" "}
              <span className="text-text-primary">{nodes.length}</span> in the
              surfaced graph
            </p>
          ) : (
            <p className="mt-4 text-sm text-text-secondary">
              No data ingested yet —{" "}
              <Link
                href="/upload"
                className="text-accent-signal underline decoration-accent-signal/40 underline-offset-4 transition-colors duration-fast ease-cubic-out hover:decoration-accent-signal"
              >
                drop your LinkedIn export
              </Link>{" "}
              to begin.
            </p>
          )}
        </div>

        {hasData && (
          <div className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            <QuickAction
              href="/graph"
              label="Explore graph"
              hint="Force-directed view, clickable"
            />
            <QuickAction
              href="/people"
              label="Browse people"
              hint={`${peopleCount.toLocaleString()} first-degree`}
            />
            <QuickAction
              href="/queries/reach"
              label="Find reach"
              hint="Strongest path to anyone"
            />
          </div>
        )}

        <p className="mt-12 max-w-xl text-center text-xs text-text-tertiary">
          The LinkedIn export contains your first-degree connections only.
          Strand derives second-degree signal from shared employers and
          overlapping employment dates — surfaced as edges with confidence
          scores. Bucket names match the underlying evidence regime; nothing
          is laundered.
        </p>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-md border border-border-subtle bg-overlay/80 px-5 py-4 backdrop-blur-sm transition-colors duration-fast ease-cubic-out hover:border-accent-signal"
    >
      <p className="font-display text-base font-semibold text-text-primary transition-colors duration-fast group-hover:text-accent-signal">
        {label}
      </p>
      <p className="mt-1 font-mono text-xs text-text-tertiary">{hint}</p>
    </Link>
  );
}
