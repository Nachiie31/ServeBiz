export const PAGE_SIZE = 25;

/** Reads a ?page= value; anything odd becomes page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = parseInt(Array.isArray(value) ? value[0] : value ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Page numbers to show: first, last, and a window around the current page, with gaps as null. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set<number>([1, pages, page - 1, page, page + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/**
 * PostgREST returns at most 1000 rows per request. This reads every page of a query so
 * dashboards and exports are never silently cut off. `build(from, to)` must return the query for that row range.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 200000,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
