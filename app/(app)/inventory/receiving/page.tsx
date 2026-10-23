import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Supplier } from "@/lib/types";
import { redirect } from "next/navigation";
import Paginator from "@/components/Paginator";
import { PAGE_SIZE, fetchAll, pageCount, parsePage } from "@/lib/paging";
import ReceivingForm from "./ReceivingForm";

type Receipt = {
  id: string;
  date_received: string;
  expiry_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  base_price: number;
  batch_no: string | null;
  products: { id: string; code: string; name: string } | null;
  suppliers: { name: string } | null;
};

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const [suppliersRes, productsRes, receiptsRes] = await Promise.all([
    fetchAll((a, b) => supabase.from("suppliers").select("id,name,contact").eq("business_id", business.id).order("name").order("id").range(a, b)),
    // The product box suggests existing codes while typing; capped so the page stays light.
    fetchAll((a, b) => supabase.from("products").select("code,name,selling_price").eq("business_id", business.id).order("name").order("id").range(a, b), 5000),
    supabase
      .from("stock_batches")
      .select("id,date_received,expiry_date,quantity_received,quantity_remaining,base_price,batch_no,products(id,code,name),suppliers(name)", { count: "exact" })
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
  ]);
  const total = receiptsRes.count ?? 0;
  if (page > 1 && page > pageCount(total)) redirect(`/inventory/receiving${pageCount(total) > 1 ? `?page=${pageCount(total)}` : ""}`);

  const suppliers = (suppliersRes ?? []) as Supplier[];
  const products = (productsRes ?? []) as { code: string; name: string; selling_price: number }[];
  const receipts = (receiptsRes.data ?? []) as unknown as Receipt[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Receiving</h2>
          <p>Record products delivered by your suppliers. New product codes create the product automatically.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 28 }}>
        <ReceivingForm businessId={business.id} suppliers={suppliers} products={products} />
      </div>

      <section className="section">
        <h3>Recent deliveries</h3>
        <div className="table-wrap">
          {receipts.length === 0 ? (
            <div className="empty">No deliveries recorded yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Received</th><th>Product</th><th>Supplier</th><th>Batch</th>
                  <th className="num">Qty</th><th className="num">Left</th><th className="num">Base price</th><th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.date_received)}</td>
                    <td>
                      {r.products ? (
                        <Link href={`/inventory/products/${r.products.id}`}>{r.products.name}</Link>
                      ) : "Unknown"}
                      <div className="muted" style={{ fontSize: 12 }}>{r.products?.code}</div>
                    </td>
                    <td>{r.suppliers?.name ?? "-"}</td>
                    <td>{r.batch_no ?? "-"}</td>
                    <td className="num">{r.quantity_received}</td>
                    <td className="num">{r.quantity_remaining}</td>
                    <td className="num">{formatMoney(r.base_price, business.currency)}</td>
                    <td>{formatDate(r.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Paginator basePath="/inventory/receiving" page={page} total={total} pageSize={PAGE_SIZE} noun="deliveries" />
      </section>
    </>
  );
}
