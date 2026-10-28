import Link from "next/link";
import { notFound } from "next/navigation";
import { getMembership, getTaxSettings } from "@/lib/business";
import { canManage } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import PrintButton from "./PrintButton";
import VoidButton from "./VoidButton";
import RefundForm, { type RefundLine } from "./RefundForm";
import { formatMoney } from "@/lib/format";
import LocalTime from "@/components/LocalTime";

export default async function SaleDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const { business, role } = (await getMembership())!;
  const taxSettings = await getTaxSettings(business.id);
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id,receipt_no,created_at,status,subtotal,discount,tax,total")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!sale) notFound();

  const [itemsRes, payRes, returnsRes, returnItemsRes] = await Promise.all([
    supabase.from("sale_items").select("id,quantity,unit_price,products(name)").eq("sale_id", id),
    supabase.from("payments").select("method,amount,amount_tendered,reference").eq("sale_id", id).limit(1),
    // Before migration 010 these tables do not exist; the page then simply shows no refunds.
    supabase.from("sale_returns").select("id,reason,refund_total,created_at").eq("sale_id", id).order("created_at", { ascending: true }),
    supabase.from("sale_return_items").select("sale_item_id,quantity,amount").eq("sale_id", id),
  ]);

  const rawItems = (itemsRes.data ?? []) as unknown as { id: string; quantity: number; unit_price: number; products: { name: string } | null }[];
  const returnedBy = new Map<string, number>();
  const refundedAmountBy = new Map<string, number>();
  for (const r of (returnItemsRes.data ?? []) as { sale_item_id: string; quantity: number; amount: number | null }[]) {
    returnedBy.set(r.sale_item_id, (returnedBy.get(r.sale_item_id) ?? 0) + r.quantity);
    refundedAmountBy.set(r.sale_item_id, (refundedAmountBy.get(r.sale_item_id) ?? 0) + Number(r.amount ?? 0));
  }
  const items = rawItems.map((i) => ({
    name: i.products?.name ?? "Item",
    quantity: i.quantity,
    unit_price: i.unit_price,
    refunded_qty: returnedBy.get(i.id) ?? 0,
    refunded_amount: refundedAmountBy.get(i.id) ?? 0,
  }));
  const lines: RefundLine[] = rawItems.map((i) => ({ id: i.id, name: i.products?.name ?? "Item", sold: i.quantity, returned: returnedBy.get(i.id) ?? 0 }));
  const returns = (returnsRes.data ?? []) as { id: string; reason: string | null; refund_total: number; created_at: string }[];
  const refundedTotal = returns.reduce((s, r) => s + Number(r.refund_total), 0);
  const pay = (payRes.data ?? [])[0] as { method: string; amount: number; amount_tendered: number | null; reference: string | null } | undefined;

  const data: ReceiptData = {
    ...(sale as Omit<ReceiptData, "items" | "method" | "tendered">),
    method: pay?.method ?? "cash",
    tendered: pay?.method === "cash" ? pay.amount_tendered : null,
    items,
    refunded: refundedTotal,
  };

  return (
    <>
      <Link href="/sales" className="back">&larr; Back to sales</Link>
      <div className="page-head">
        <div>
          <h2>Receipt {data.receipt_no}</h2>
          {pay?.reference && <p>Payment reference: {pay.reference}</p>}
        </div>
      </div>

      {paid === "1" && (
        <div className="alert" style={{ maxWidth: 380 }}>Online payment received. The sale is recorded and stock updated.</div>
      )}

      <div style={{ maxWidth: 380 }}>
        <Receipt
          business={business}
          currency={business.currency}
          data={data}
          taxLabel={taxSettings.rate > 0 ? `${taxSettings.name} (${taxSettings.rate}%${taxSettings.inclusive ? ", included" : ""})` : taxSettings.name}
        />
        <div className="modal-actions">
          <PrintButton />
          {data.status === "completed" && canManage(role) && <RefundForm saleId={id} lines={lines} />}
          {data.status === "completed" && canManage(role) && returns.length === 0 && <VoidButton saleId={id} />}
        </div>

        {returns.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>Refunds</h3>
            {returns.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, padding: "4px 0" }}>
                <span><LocalTime iso={r.created_at} />{r.reason ? <span className="muted"> · {r.reason}</span> : null}</span>
                <strong>-{formatMoney(Number(r.refund_total), business.currency)}</strong>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 8 }}>
              <span>Total refunded</span><strong>{formatMoney(refundedTotal, business.currency)}</strong>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
