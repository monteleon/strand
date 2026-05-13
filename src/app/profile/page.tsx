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
  return { owner, positionCount, currentPositions: currentPositions.filter((p) => p.current) };
}

export default async function ProfilePage() {
  const data = await loadOwner();

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="border-b border-border pb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        </header>
        <p data-testid="empty-profile" className="mt-8 text-sm text-muted-foreground">
          No profile ingested yet. Drop your LinkedIn export at{" "}
          <a className="underline underline-offset-4" href="/upload">
            /upload
          </a>{" "}
          to populate your profile.
        </p>
      </main>
    );
  }

  const { owner, positionCount, currentPositions } = data;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Owner
        </p>
        <h1
          data-testid="profile-name"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {owner.fullName}
        </h1>
        {owner.headline && (
          <p data-testid="profile-headline" className="mt-3 text-base text-muted-foreground">
            {owner.headline}
          </p>
        )}
      </header>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Positions
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {positionCount} total · {currentPositions.length} currently active
        </p>
        {currentPositions.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {currentPositions.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border bg-muted/10 px-4 py-3"
              >
                <p className="font-medium">{p.title ?? "(no title)"}</p>
                <p className="text-xs text-muted-foreground">
                  since {p.startDate ?? "(unknown)"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
