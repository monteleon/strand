import { listSavedQueries } from "@/lib/queries/savedQueries";
import { PersonPicker } from "@/components/person-picker";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function WorkedWithIndexPage() {
  const bookmarks = await listSavedQueries();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Queries
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Who has worked with…
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Pick a person to see everyone in your network with a manual or
          derived edge to them — collapsed across companies, kept honest
          about provenance.
        </p>
      </header>

      <PersonPicker basePath="/queries/worked-with" placeholder="Search a person…" />

      <SavedQueriesSidebar bookmarks={bookmarks} />
    </main>
  );
}
