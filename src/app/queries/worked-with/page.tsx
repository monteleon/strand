import { listSavedQueries } from "@/lib/queries/savedQueries";
import { PersonPicker } from "@/components/person-picker";
import { SavedQueriesSidebar } from "@/components/saved-queries-sidebar";

export const dynamic = "force-dynamic";

export default async function WorkedWithIndexPage() {
  const bookmarks = await listSavedQueries();
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Queries
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Who has worked with…
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            Pick a person to see everyone in your network with a manual or
            derived edge to them — collapsed across companies, kept honest
            about provenance.
          </p>
        </header>

        <PersonPicker
          basePath="/queries/worked-with"
          placeholder="Search a person…"
        />

        <SavedQueriesSidebar bookmarks={bookmarks} />
      </div>
    </div>
  );
}
