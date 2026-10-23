import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import type { Batch, Product, StockRow } from "@/lib/types";
import { fetchAll } from "@/lib/paging";
import SalesPanel from "./SalesPanel";

const EXPIRY_WINDOW_DAYS = 30;

export default async function Dashboard() {
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  // Read every row, not just the first 1000 the API returns by default.
  const [productsData, stockData, batchesData, totalsRes] = await Promise.all([
    fetchAll((a, b) =>
      supabase.from("products").select("id,code,name,selling_price,reorder_level,is_active")
        .eq("business_id", business.id).order("id").range(a, b)),
    fetchAll((a, b) =>
      supabase.from("product_stock").select("product_id,total_quantity,nearest_expiry")
        .eq("business_id", business.id).order("product_id").range(a, b)),
    fetchAll((a, b) =>
      supabase.from("stock_batches").select("id,product_id,expiry_date,quantity_remaining,base_price,batch_no")
        .eq("business_id", business.id).gt("quantity_remaining", 0).order("id").range(a, b)),
    supabase.rpc("sales_totals", { p_business_id: business.id }),
  ]);

  // All-time income: net sales (what customers paid minus tax), completed sales only.
  const totals = ((totalsRes.data ?? []) as { income: number; sale_count: number }[])[0];
  const totalIncome = totals ? Number(totals.income) : null;
  const totalSales = totals ? Number(totals.sale_count) : 0;

  const products = (productsData ?? []) as Pick<Product, "id" | "code" | "name" | "selling_price" | "reorder_level" | "is_active">[];
  const stock = (stockData ?? []) as StockRow[];
  const batches = (batchesData ?? []) as Pick<Batch, "id" | "product_id" | "expiry_date" | "quantity_remaining" | "base_price" | "batch_no">[];

  const qty = new Map(stock.map((s) => [s.product_id, s.total_quantity]));
  const byId = new Map(products.map((p) => [p.id, p]));

  const unitsInStock = stock.reduce((sum, s) => sum + s.total_quantity, 0);
  const inventoryValue = batches.reduce((sum, b) => sum + b.quantity_remaining * b.base_price, 0);
  const needsPricing = products.filter((p) => !p.is_active || p.selling_price <= 0).length;

  const lowStock = products
    .filter((p) => p.reorder_level > 0 && (qty.get(p.id) ?? 0) <= p.reorder_level)
    .sort((a, b) => (qty.get(a.id) ?? 0) - (qty.get(b.id) ?? 0));

  const expiring = batches
    .filter((b) => b.expiry_date && daysUntil(b.expiry_date) <= EXPIRY_WINDOW_DAYS)
    .sort((a, b) => (a.expiry_date! < b.expiry_date! ? -1 : 1));

  const expiredCount = expiring.filter((b) => daysUntil(b.expiry_date!) < 0).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Inventory at a glance for {business.name}.</p>
        </div>
        <Link href="/inventory/receiving" className="btn btn-primary">Receive products</Link>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Total income</div>
          <div className="value">{totalIncome === null ? "-" : formatMoney(totalIncome, business.currency)}</div>
          <div className="sub">
            {totalIncome === null ? "Run migration 005 to see this" : `${totalSales} sale${totalSales === 1 ? "" : "s"}, before tax`}
          </div>
        </div>
        <div className="stat"><div className="label">Products</div><div className="value">{products.length}</div></div>
        <div className="stat"><div className="label">Units in stock</div><div className="value">{unitsInStock}</div></div>
        <div className="stat"><div className="label">Stock value (at cost)</div><div className="value">{formatMoney(inventoryValue, business.currency)}</div></div>
        <div className={`stat${lowStock.length ? " warn" : ""}`}><div className="label">Low stock</div><div className="value">{lowStock.length}</div></div>
        <div className={`stat${expiredCount ? " warn" : ""}`}><div className="label">Expired / expiring ({EXPIRY_WINDOW_DAYS}d)</div><div className="value">{expiring.length}</div></div>
        <div className={`stat${needsPricing ? " warn" : ""}`}><div className="label">Need pricing</div><div className="value">{needsPricing}</div></div>
      </div>

      {products.length === 0 && (
        <div className="alert">
          No products yet. Start by <Link href="/inventory/receiving"><strong>receiving your first delivery</strong></Link>; each new product code creates a product automatically.
        </div>
      )}

      {needsPricing > 0 && (
        <div className="alert warn">
          {needsPricing} product{needsPricing === 1 ? "" : "s"} still need a selling price before they can be sold.{" "}
          <Link href="/inventory/products?filter=pricing"><strong>Set prices</strong></Link>
        </div>
      )}

      <SalesPanel businessId={business.id} currency={business.currency} />

      <div className="two-col">
        <section className="section">
          <h3>Low stock</h3>
          <div className="table-wrap">
            {lowStock.length === 0 ? (
              <div className="empty">Nothing is running low. Set a reorder level on a product to get alerts.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Product</th><th className="num">On hand</th><th className="num">Reorder at</th></tr></thead>
                <tbody>
                  {lowStock.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/inventory/products/${p.id}`}>{p.name}</Link></td>
                      <td className="num">{qty.get(p.id) ?? 0}</td>
                      <td className="num">{p.reorder_level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="section">
          <h3>Expiring soon</h3>
          <div className="table-wrap">
            {expiring.length === 0 ? (
              <div className="empty">No batches expire in the next {EXPIRY_WINDOW_DAYS} days.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Product</th><th className="num">Qty</th><th>Expires</th></tr></thead>
                <tbody>
                  {expiring.slice(0, 8).map((b) => {
                    const p = byId.get(b.product_id);
                    const d = daysUntil(b.expiry_date!);
                    return (
                      <tr key={b.id}>
                        <td>{p ? <Link href={`/inventory/products/${p.id}`}>{p.name}</Link> : "Unknown"}</td>
                        <td className="num">{b.quantity_remaining}</td>
                        <td>
                          {formatDate(b.expiry_date)}{" "}
                          <span className={`chip${d < 0 ? " warn" : " gray"}`}>{d < 0 ? "Expired" : d === 0 ? "Today" : `${d}d`}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
