import Link from "next/link";
import type { SavedQuery } from "@/lib/queries/savedQueries";
import { DeleteBookmark } from "./delete-bookmark";

export function SavedQueriesSidebar({ bookmarks }: { bookmarks: SavedQuery[] }) {
  return (
    <section className="mt-12" data-testid="saved-queries-section">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
        Saved queries
      </h2>
      {bookmarks.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No saved queries yet. Bookmark a query to save the current filter
          combination.
        </p>
      ) : (
        <ul
          data-testid="saved-queries-list"
          className="mt-4 divide-y divide-border rounded-md border border-border"
        >
          {bookmarks.map((b) => (
            <li
              key={b.id}
              data-testid="saved-query-row"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <Link
                href={b.url}
                className="block flex-1 truncate hover:underline"
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
