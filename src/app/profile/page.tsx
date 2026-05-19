import { and, eq } from "drizzle-orm";
import { LOCAL_TENANT_ID, db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

async function loadOwner() {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, LOCAL_TENANT_ID))
    .limit(1);
  if (!tenant?.ownerPersonId) return null;
  const [owner] = await db
    .select()
    .from(schema.people)
    .where(eq(schema.people.id, tenant.ownerPersonId))
    .limit(1);
  if (!owner) return null;
  // Profile timeline shows declared positions only — synthesised rows (from
  // network metadata) belong to connections, not to the owner. ISC-74.
  const declaredWhere = and(
    eq(schema.positions.personId, owner.id),
    eq(schema.positions.origin, "declared"),
  );
  const positionCount = await db.$count(schema.positions, declaredWhere);
  const currentPositions = await db
    .select()
    .from(schema.positions)
    .where(declaredWhere);
  return {
    owner,
    positionCount,
    currentPositions: currentPositions.filter((p) => p.current),
  };
}

export default async function ProfilePage() {
  const data = await loadOwner();

  if (!data) {
    return (
      <div className="min-h-screen bg-canvas text-text-primary">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <header className="border-b border-border-subtle pb-6">
            <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
              Profile
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              You
            </h1>
          </header>
          <p
            data-testid="empty-profile"
            className="mt-6 text-sm text-text-secondary"
          >
            No profile ingested yet. Drop your LinkedIn export at{" "}
            <a
              className="text-accent-signal underline decoration-accent-signal/40 underline-offset-4 transition-colors duration-fast ease-cubic-out hover:decoration-accent-signal"
              href="/upload"
            >
              /upload
            </a>{" "}
            to populate your profile.
          </p>
        </div>
      </div>
    );
  }

  const { owner, positionCount, currentPositions } = data;

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Owner
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <h1
              data-testid="profile-name"
              className="font-display text-3xl font-semibold tracking-tight"
            >
              {owner.fullName}
            </h1>
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent-warmth">
              · you
            </span>
          </div>
          {owner.headline && (
            <p
              data-testid="profile-headline"
              className="mt-3 text-base text-text-secondary"
            >
              {owner.headline}
            </p>
          )}
        </header>

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Positions
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            <span className="font-mono text-text-primary">{positionCount}</span>{" "}
            total ·{" "}
            <span className="font-mono text-text-primary">
              {currentPositions.length}
            </span>{" "}
            currently active
          </p>
          {currentPositions.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {currentPositions.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border border-border-subtle bg-surface px-4 py-3"
                >
                  <p className="font-medium text-text-primary">
                    {p.title ?? "(no title)"}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                    since {p.startDate ?? "(unknown)"}
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
