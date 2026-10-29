import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { PO_STATUS_LABEL } from "@/lib/po";
import ReceivePoForm, { type PoLine } from "./ReceivePoForm";
import PrintButton from "../../../sales/[id]/PrintButton";

export default async function PurchaseOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const business = (await requireBusiness());
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id,po_number,status,expected_date,notes,created_at,suppliers(name)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!po) notFound();
  const order = po as unknown as { id: string; po_number: string; status: string; expected_date: string | null; notes: string | null; created_at: string; suppliers: { name: string } | null };

  const { data: items } = await supabase
    .from("purchase_order_items")
    .select("id,product_code,product_name,quantity,unit_cost,received_quantity")
    .eq("po_id", id).order("product_name");
  const lines = ((items ?? []) as { id: string; product_code: string; product_name: string; quantity: number; unit_cost: number; received_quantity: number }[]);
  const total = lines.reduce((s, l) => s + l.quantity * Number(l.unit_cost), 0);
  const open = order.status === "ordered" || order.status === "partial";

  const poLines: PoLine[] = lines.map((l) => ({ id: l.id, code: l.product_code, name: l.product_name, remaining: l.quantity - l.received_quantity }));

  return (
    <>
      <Link href="/inventory/purchase-orders" className="back">&larr; Back to purchase orders</Link>
      <div className="page-head">
        <div>
          <h2>{order.po_number} <span className={`chip${order.status === "received" ? "" : " warn"}`} style={{ marginLeft: 8, fontSize: 13 }}>{PO_STATUS_LABEL[order.status] ?? order.status}</span></h2>
          <p>
            {order.suppliers?.name ?? "No supplier"} · created {formatDate(order.created_at.slice(0, 10))}
            {order.expected_date ? ` · expected ${formatDate(order.expected_date)}` : ""}
            {order.notes ? ` · ${order.notes}` : ""}
          </p>
        </div>
        <div className="head-actions"><PrintButton /></div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Left</th><th className="num">Unit cost</th><th className="num">Line total</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.product_name}<div className="muted" style={{ fontSize: 12 }}>{l.product_code}</div></td>
                <td className="num">{l.quantity}</td>
                <td className="num">{l.received_quantity}</td>
                <td className="num">{l.quantity - l.received_quantity}</td>
                <td className="num">{formatMoney(Number(l.unit_cost), business.currency)}</td>
                <td className="num">{formatMoney(l.quantity * Number(l.unit_cost), business.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5} style={{ textAlign: "right" }}><strong>Total</strong></td><td className="num"><strong>{formatMoney(total, business.currency)}</strong></td></tr></tfoot>
        </table>
      </div>

      {open && <ReceivePoForm poId={order.id} lines={poLines} partial={order.status === "partial"} />}
    </>
  );
}
