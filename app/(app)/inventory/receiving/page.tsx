import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Supplier } from "@/lib/types";
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

export default async function ReceivingPage() {
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const [suppliersRes, productsRes, receiptsRes] = await Promise.all([
    supabase.from("suppliers").select("id,name,contact").eq("business_id", business.id).order("name"),
    supabase.from("products").select("code,name,selling_price").eq("business_id", business.id).order("name"),
    supabase
      .from("stock_batches")
      .select("id,date_received,expiry_date,quantity_received,quantity_remaining,base_price,batch_no,products(id,code,name),suppliers(name)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const suppliers = (suppliersRes.data ?? []) as Supplier[];
  const products = (productsRes.data ?? []) as { code: string; name: string; selling_price: number }[];
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
      </section>
    </>
  );
}
