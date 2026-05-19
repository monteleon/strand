import Link from "next/link";
import type { SavedQuery } from "@/lib/queries/savedQueries";
import { DeleteBookmark } from "./delete-bookmark";

export function SavedQueriesSidebar({ bookmarks }: { bookmarks: SavedQuery[] }) {
  return (
    <section className="mt-10" data-testid="saved-queries-section">
      <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
        Saved queries
      </h2>
      {bookmarks.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">
          No saved queries yet. Bookmark a query to save the current filter
          combination.
        </p>
      ) : (
        <ul
          data-testid="saved-queries-list"
          className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
        >
          {bookmarks.map((b) => (
            <li
              key={b.id}
              data-testid="saved-query-row"
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <Link
                href={b.url}
                className="block flex-1 truncate text-text-primary transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
              >
                {b.name}
              </Link>
              <DeleteBookmark id={b.id} name={b.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
