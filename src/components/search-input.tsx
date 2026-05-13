// Plain form-based search input. Submits via GET so the query lives in
// the URL — back/forward and link-sharing both work. No client JS needed.
export function SearchInput({
  basePath,
  q,
  placeholder,
}: {
  basePath: string;
  q: string;
  placeholder: string;
}) {
  return (
    <form
      data-testid="search-form"
      action={basePath}
      method="get"
      className="mt-6 flex items-center gap-2"
    >
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
        autoComplete="off"
      />
      <button
        type="submit"
        className="rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted/40"
      >
        Search
      </button>
      {q && (
        <a
          href={basePath}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          clear
        </a>
      )}
    </form>
  );
}
