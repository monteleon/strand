import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  basePath: string;
  page: number;
  totalPages: number;
  q: string;
  hasPrev: boolean;
  hasNext: boolean;
  sort?: string;
  // Extra query params (e.g. company/status on /queries/at-company) carried
  // across page navigation. Undefined/empty values are omitted so default
  // filters keep the URL clean.
  extraParams?: Record<string, string | undefined>;
};

function buildHref(
  basePath: string,
  page: number,
  q: string,
  sort?: string,
  extraParams?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function PageNav({
  basePath,
  page,
  totalPages,
  q,
  hasPrev,
  hasNext,
  sort,
  extraParams,
}: Props) {
  if (totalPages <= 1) return null;
  return (
    <nav
      data-testid="page-nav"
      className="mt-6 flex items-center justify-between text-sm"
    >
      <PageLink
        disabled={!hasPrev}
        href={buildHref(basePath, page - 1, q, sort, extraParams)}
        label="← Previous"
      />
      <span className="font-mono text-xs text-text-secondary">
        Page <span className="text-text-primary">{page}</span> of{" "}
        <span className="text-text-primary">{totalPages}</span>
      </span>
      <PageLink
        disabled={!hasNext}
        href={buildHref(basePath, page + 1, q, sort, extraParams)}
        label="Next →"
      />
    </nav>
  );
}

function PageLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) {
    return (
      <span className="cursor-default font-mono text-xs text-text-tertiary">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "rounded-sm border border-border-subtle bg-overlay px-3 py-1.5 font-mono text-xs text-text-primary transition-colors duration-fast ease-cubic-out hover:border-accent-signal hover:text-accent-signal",
      )}
    >
      {label}
    </Link>
  );
}
