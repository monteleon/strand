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
        className="flex-1 rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-fast ease-cubic-out focus:border-accent-signal focus:outline-none"
        autoComplete="off"
      />
      <button
        type="submit"
        className="rounded-sm border border-border-subtle bg-overlay px-3 py-2 text-sm text-text-primary transition-colors duration-fast ease-cubic-out hover:border-border-strong hover:bg-surface"
      >
        Search
      </button>
      {q && (
        <a
          href={basePath}
          className="font-mono text-xs text-text-secondary underline decoration-text-tertiary underline-offset-4 transition-colors duration-fast ease-cubic-out hover:text-accent-signal hover:decoration-accent-signal"
        >
          clear
        </a>
      )}
    </form>
  );
}
