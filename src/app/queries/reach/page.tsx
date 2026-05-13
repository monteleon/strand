import { listSavedQueries } from "@/lib/queries/savedQueries";
import { PersonPicker } from "@/components/person-picker";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function ReachIndexPage() {
  const bookmarks = await listSavedQueries();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Queries
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Strongest reach to…
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Pick a person to see the strongest intermediaries in your network
          who could introduce, vouch, or co-introduce. Manual edges rank
          above derived; within derived, ties broken by overlap-months.
        </p>
      </header>

      <PersonPicker basePath="/queries/reach" placeholder="Search a person…" />

      <SavedQueriesSidebar bookmarks={bookmarks} />
    </main>
  );
}
