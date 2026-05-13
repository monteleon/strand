export const PAGE_SIZE = 50;

export type PageParams = {
  page: number; // 1-indexed
  q: string;
};

export function parsePageParams(
  searchParams: Record<string, string | string[] | undefined>,
): PageParams {
  const rawPage = Array.isArray(searchParams.page)
    ? searchParams.page[0]
    : searchParams.page;
  const rawQ = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  const n = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(n) && n >= 1 ? n : 1;
  const q = (rawQ ?? "").trim();
  return { page, q };
}

export function pageWindow(page: number, total: number) {
  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  return { offset, totalPages, hasPrev, hasNext };
}
