import { listSavedQueries } from "@/lib/queries/savedQueries";
import { PersonPicker } from "@/components/person-picker";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function ReachIndexPage() {
  const bookmarks = await listSavedQueries();
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Queries
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Strongest reach to…
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            Pick a person to see the strongest intermediaries in your network
            who could introduce, vouch, or co-introduce. Manual edges rank
            above derived; within derived, ties broken by overlap-months.
          </p>
        </header>

        <PersonPicker basePath="/queries/reach" placeholder="Search a person…" />

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
  );
}
