import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import type { Batch, Category, Movement, Product } from "@/lib/types";
import Paginator from "@/components/Paginator";
import { PAGE_SIZE, parsePage } from "@/lib/paging";
import LocalTime from "@/components/LocalTime";
import ProductForm from "./ProductForm";
import AdjustStockForm from "./AdjustStockForm";

const TYPE_LABEL: Record<string, string> = {
  receive: "Received",
  sale: "Sold",
  adjustment: "Adjustment",
  return: "Returned",
  expired: "Expired",
  damaged: "Damaged",
};

export default async function ProductDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mpage?: string }> }) {
  const { id } = await params;
  const mpage = parsePage((await searchParams).mpage);
  const mFrom = (mpage - 1) * PAGE_SIZE;
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const { data: productData } = await supabase
    .from("products")
    .select("id,business_id,code,barcode,name,category_id,unit,selling_price,reorder_level,is_active")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!productData) notFound();
  const product = productData as Product;

  const [catRes, batchRes, moveRes] = await Promise.all([
    supabase.from("categories").select("id,name").eq("business_id", business.id).order("name"),
    supabase
      .from("stock_batches")
      .select("id,product_id,supplier_id,batch_no,date_received,expiry_date,quantity_received,quantity_remaining,base_price")
      .eq("product_id", id)
      .order("date_received", { ascending: false }),
    supabase
      .from("stock_movements")
      .select("id,movement_type,quantity_change,reason,created_at", { count: "exact" })
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(mFrom, mFrom + PAGE_SIZE - 1),
  ]);

  const categories = (catRes.data ?? []) as Category[];
  const batches = (batchRes.data ?? []) as Batch[];
  const movements = (moveRes.data ?? []) as Movement[];

  const total = batches.reduce((sum, b) => sum + b.quantity_remaining, 0);
  const active = batches.filter((b) => b.quantity_remaining > 0);
  const latestCost = batches[0]?.base_price ?? null;

  return (
    <>
      <Link href="/inventory/products" className="back">&larr; Back to products</Link>
      <div className="page-head">
        <div>
          <h2>{product.name}</h2>
          <p>Code {product.code} &middot; {total} {product.unit} in stock{latestCost !== null ? ` · latest cost ${formatMoney(latestCost, business.currency)}` : ""}</p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Product details</h3>
          <ProductForm
            businessId={business.id}
            product={product}
            categories={categories}
            latestCost={latestCost}
            currency={business.currency}
          />
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 6 }}>Remove stock</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            For damaged, expired, or lost items. Stock comes off the earliest-expiring batch first unless you pick one. To add stock, record a delivery in Receiving.
          </p>
          <AdjustStockForm
            productId={product.id}
            total={total}
            batches={active.map((b) => ({
              id: b.id,
              label: `${b.batch_no ? b.batch_no + " · " : ""}received ${formatDate(b.date_received)} · ${b.quantity_remaining} left`,
            }))}
          />
        </div>
      </div>

      <section className="section" style={{ marginTop: 28 }}>
        <h3>Batches</h3>
        <div className="table-wrap">
          {batches.length === 0 ? (
            <div className="empty">No batches yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Batch</th><th>Received</th><th>Expiry</th><th className="num">Received qty</th><th className="num">Remaining</th><th className="num">Base price</th></tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const d = b.expiry_date ? daysUntil(b.expiry_date) : null;
                  return (
                    <tr key={b.id}>
                      <td>{b.batch_no ?? "-"}</td>
                      <td>{formatDate(b.date_received)}</td>
                      <td>
                        {formatDate(b.expiry_date)}{" "}
                        {d !== null && b.quantity_remaining > 0 && d <= 30 && (
                          <span className={`chip${d < 0 ? " warn" : " gray"}`}>{d < 0 ? "Expired" : `${d}d`}</span>
                        )}
                      </td>
                      <td className="num">{b.quantity_received}</td>
                      <td className="num">{b.quantity_remaining}</td>
                      <td className="num">{formatMoney(b.base_price, business.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="section">
        <h3>Stock history</h3>
        <div className="table-wrap">
          {movements.length === 0 ? (
            <div className="empty">No stock movements yet.</div>
          ) : (
            <table className="table">
              <thead><tr><th>When</th><th>Type</th><th className="num">Change</th><th>Reason</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td><LocalTime iso={m.created_at} /></td>
                    <td>{TYPE_LABEL[m.movement_type] ?? m.movement_type}</td>
                    <td className="num">{m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}</td>
                    <td>{m.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Paginator basePath={`/inventory/products/${id}`} page={mpage} total={moveRes.count ?? 0} pageSize={PAGE_SIZE}
          pageParam="mpage" noun="movements" />
      </section>
    </>
  );
}
