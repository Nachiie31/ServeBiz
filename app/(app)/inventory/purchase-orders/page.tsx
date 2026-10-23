import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";
import { PO_STATUS_LABEL } from "@/lib/po";
import Paginator from "@/components/Paginator";


const TABS = [
  { key: "open", label: "Open" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type Row = {
  id: string; po_number: string; status: string; expected_date: string | null; created_at: string;
  suppliers: { name: string } | null;
  purchase_order_items: { quantity: number; unit_cost: number; received_quantity: number }[];
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.status) ? sp.status! : "open";
  const page = parsePage(sp.page);
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from("purchase_orders")
    .select("id,po_number,status,expected_date,created_at,suppliers(name),purchase_order_items(quantity,unit_cost,received_quantity)", { count: "exact" })
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (tab === "open") query = query.in("status", ["ordered", "partial"]);
  else if (tab !== "all") query = query.eq("status", tab);
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    return <div className="alert warn">Purchase orders need <code>supabase/migrations/011_purchase_orders.sql</code>. Run it in the Supabase SQL Editor, then refresh.</div>;
  }
  const total = count ?? 0;
  if (page > 1 && page > pageCount(total)) redirect(`/inventory/purchase-orders?status=${tab}`);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Purchase orders</h2>
          <p>Order from a supplier, then receive the delivery against the order.</p>
        </div>
        <div className="head-actions">
          <Link href="/inventory/purchase-orders/new" className="btn btn-primary">New purchase order</Link>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/inventory/purchase-orders?status=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>{t.label}</Link>
        ))}
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">{tab === "open" ? "No open orders. " : "Nothing here. "}<Link href="/inventory/purchase-orders/new"><strong>Create a purchase order</strong></Link>.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Order</th><th>Supplier</th><th>Created</th><th>Expected</th><th className="num">Items</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const sum = r.purchase_order_items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0);
                const got = r.purchase_order_items.reduce((s, i) => s + i.received_quantity, 0);
                const want = r.purchase_order_items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <tr key={r.id}>
                    <td><Link href={`/inventory/purchase-orders/${r.id}`}>{r.po_number}</Link></td>
                    <td>{r.suppliers?.name ?? "-"}</td>
                    <td>{formatDate(r.created_at.slice(0, 10))}</td>
                    <td>{formatDate(r.expected_date)}</td>
                    <td className="num">{r.status === "partial" ? `${got}/${want}` : want}</td>
                    <td className="num">{formatMoney(sum, business.currency)}</td>
                    <td><span className={`chip${r.status === "received" ? "" : " warn"}`}>{PO_STATUS_LABEL[r.status] ?? r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Paginator basePath="/inventory/purchase-orders" params={{ status: tab === "open" ? undefined : tab }} page={page} total={total} pageSize={PAGE_SIZE} noun="orders" />
    </>
  );
}
