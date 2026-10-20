import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Category, Product, StockRow } from "@/lib/types";

type SearchParams = Promise<{ q?: string; filter?: string }>;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pricing", label: "Needs pricing" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
];

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q = "", filter = "all" } = await searchParams;
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const [productsRes, stockRes, catRes, costRes] = await Promise.all([
    supabase.from("products")
      .select("id,business_id,code,barcode,name,category_id,unit,selling_price,reorder_level,is_active")
      .eq("business_id", business.id)
      .order("name"),
    supabase.from("product_stock").select("product_id,total_quantity,nearest_expiry").eq("business_id", business.id),
    supabase.from("categories").select("id,name").eq("business_id", business.id),
    supabase
      .from("stock_batches")
      .select("product_id,base_price,created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false }),
  ]);

  // Latest cost per product (rows arrive newest first, so the first one seen wins)
  const latestCost = new Map<string, number>();
  for (const b of (costRes.data ?? []) as { product_id: string; base_price: number }[]) {
    if (!latestCost.has(b.product_id)) latestCost.set(b.product_id, b.base_price);
  }

  const products = (productsRes.data ?? []) as Product[];
  const stock = new Map(((stockRes.data ?? []) as StockRow[]).map((s) => [s.product_id, s]));
  const categories = new Map(((catRes.data ?? []) as Category[]).map((c) => [c.id, c.name]));

  const needle = q.trim().toLowerCase();
  const rows = products
    .filter((p) => {
      const qty = stock.get(p.id)?.total_quantity ?? 0;
      if (needle && !`${p.name} ${p.code} ${p.barcode ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "pricing") return !p.is_active || p.selling_price <= 0;
      if (filter === "low") return p.reorder_level > 0 && qty <= p.reorder_level;
      if (filter === "out") return qty === 0;
      return true;
    });

  const href = (f: string) => `/inventory/products?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

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
            {products.length === 0
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
                const s = stock.get(p.id);
                const qty = s?.total_quantity ?? 0;
                const low = p.reorder_level > 0 && qty <= p.reorder_level;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/inventory/products/${p.id}`}>{p.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{p.code}</div>
                    </td>
                    <td>{p.category_id ? categories.get(p.category_id) ?? "-" : "-"}</td>
                    <td className="num">{qty} {p.unit}</td>
                    <td className="num">
                      {p.selling_price > 0 ? (
                        formatMoney(p.selling_price, business.currency)
                      ) : (
                        <Link href={`/inventory/products/${p.id}`}>Set price</Link>
                      )}
                      {latestCost.has(p.id) && (
                        <div className="muted" style={{ fontSize: 12 }}>cost {formatMoney(latestCost.get(p.id)!, business.currency)}</div>
                      )}
                    </td>
                    <td>{formatDate(s?.nearest_expiry ?? null)}</td>
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
    </>
  );
}
