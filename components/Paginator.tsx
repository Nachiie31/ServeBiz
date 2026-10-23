import Link from "next/link";
import { pageCount, pageWindow } from "@/lib/paging";

type Props = {
  basePath: string;
  /** the other query params to keep (search, filter, range ...) */
  params?: Record<string, string | undefined>;
  page: number;
  total: number;
  pageSize: number;
  /** name of the page param, for pages with more than one list */
  pageParam?: string;
  noun?: string;
};

export default function Paginator({ basePath, params = {}, page, total, pageSize, pageParam = "page", noun = "items" }: Props) {
  const pages = pageCount(total, pageSize);
  if (total <= pageSize) {
    return total > 0 ? <p className="muted pager-info">{total} {noun}</p> : null;
  }
  const href = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (n > 1) sp.set(pageParam, String(n));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted pager-info">Showing {from}-{to} of {total} {noun}</span>
      <div className="pager-links">
        {page > 1 ? <Link className="btn" href={href(page - 1)} rel="prev">Previous</Link> : <span className="btn disabled" aria-disabled="true">Previous</span>}
        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap${i}`} className="pager-gap">…</span>
          ) : (
            <Link key={n} href={href(n)} className={`btn${n === page ? " btn-primary" : ""}`} aria-current={n === page ? "page" : undefined}>{n}</Link>
          ),
        )}
        {page < pages ? <Link className="btn" href={href(page + 1)} rel="next">Next</Link> : <span className="btn disabled" aria-disabled="true">Next</span>}
      </div>
    </nav>
  );
}
