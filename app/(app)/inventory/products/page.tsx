import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { redirect } from "next/navigation";
import Paginator from "@/components/Paginator";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";

type SearchParams = Promise<{ q?: string; filter?: string; page?: string }>;

type ListRow = {
  id: string; code: string; barcode: string | null; name: string; category_name: string | null; unit: string;
  selling_price: number; reorder_level: number; is_active: boolean; total_quantity: number;
  nearest_expiry: string | null; latest_cost: number | null; total_count: number;
};

function withPage(q: string, filter: string, page: number) {
  const sp = new URLSearchParams({ filter });
  if (q) sp.set("q", q);
  if (page > 1) sp.set("page", String(page));
  return `/inventory/products?${sp}`;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pricing", label: "Needs pricing" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
];

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { q = "", filter = "all" } = sp;
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const page = parsePage(sp.page);
  const f = FILTERS.some((x) => x.key === filter) ? filter : "all";
  const run = (pg: number) =>
    supabase.rpc("list_products", {
      p_business_id: business.id,
      p_q: q.trim(),
      p_filter: f,
      p_limit: PAGE_SIZE,
      p_offset: (pg - 1) * PAGE_SIZE,
    });
  let res = await run(page);
  let total = Number(((res.data ?? []) as ListRow[])[0]?.total_count ?? 0);
  // Asked for a page past the end (e.g. after a filter or a deletion): go back to the last real page.
  if (res.data && res.data.length === 0 && page > 1) {
    const last = (await run(1)).data as ListRow[] | null;
    redirect(withPage(q, f, pageCount(Number(last?.[0]?.total_count ?? 0))));
  }
  const rows = (res.data ?? []) as ListRow[];
  const catalogEmpty = rows.length === 0 && !q.trim() && f === "all";

  const href = (fk: string) => `/inventory/products?filter=${fk}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Products</h2>
          <p>Set selling prices and details. Quantity is calculated from received batches.</p>
        </div>
        <div className="head-actions">
          <a href="/api/export/products" className="btn" download>Export products</a>
          <a href="/api/export/stock" className="btn" download>Export stock batches</a>
          <Link href="/inventory/receiving" className="btn btn-primary">Receive products</Link>
        </div>
      </div>

      <form className="toolbar" action="/inventory/products">
        <input type="hidden" name="filter" value={filter} />
        <input className="input" name="q" defaultValue={q} placeholder="Search name, code, or barcode" aria-label="Search products" />
        <button className="btn" type="submit">Search</button>
        <div className="tabs">
          {FILTERS.map((f) => (
            <Link key={f.key} href={href(f.key)} className={`tab${filter === f.key ? " active" : ""}`}>{f.label}</Link>
          ))}
        </div>
      </form>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            {catalogEmpty
              ? <>No products yet. <Link href="/inventory/receiving"><strong>Receive your first delivery</strong></Link> to create one.</>
              : "No products match."}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th><th>Category</th><th className="num">In stock</th>
                <th className="num">Selling price</th><th>Next expiry</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const qty = p.total_quantity ?? 0;
                const low = p.reorder_level > 0 && qty <= p.reorder_level;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/inventory/products/${p.id}`}>{p.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{p.code}</div>
                    </td>
                    <td>{p.category_name ?? "-"}</td>
                    <td className="num">{qty} {p.unit}</td>
                    <td className="num">
                      {p.selling_price > 0 ? (
                        formatMoney(p.selling_price, business.currency)
                      ) : (
                        <Link href={`/inventory/products/${p.id}`}>Set price</Link>
                      )}
                      {p.latest_cost !== null && (
                        <div className="muted" style={{ fontSize: 12 }}>cost {formatMoney(Number(p.latest_cost), business.currency)}</div>
                      )}
                    </td>
                    <td>{formatDate(p.nearest_expiry ?? null)}</td>
                    <td>
                      {!p.is_active || p.selling_price <= 0 ? (
                        <span className="chip warn">Needs pricing</span>
                      ) : qty === 0 ? (
                        <span className="chip warn">Out of stock</span>
                      ) : low ? (
                        <span className="chip warn">Low stock</span>
                      ) : (
                        <span className="chip">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Paginator basePath="/inventory/products" params={{ q: q || undefined, filter: f === "all" ? undefined : f }}
        page={page} total={total} pageSize={PAGE_SIZE} noun="products" />
    </>
  );
}
