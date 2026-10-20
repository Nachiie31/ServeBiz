import Link from "next/link";
import { getMembership } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import LocalTime from "@/components/LocalTime";

type SaleRow = {
  id: string;
  receipt_no: string | null;
  created_at: string;
  total: number;
  status: string;
  payments: { method: string }[];
};

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", ewallet: "E-wallet", stripe: "Online" };

export default async function SalesPage() {
  const { business, role } = (await getMembership())!;
  const isCashier = role === "cashier";
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id,receipt_no,created_at,total,status,payments(method)")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const sales = (data ?? []) as unknown as SaleRow[];
  const completed = sales.filter((s) => s.status === "completed");
  const revenue = completed.reduce((sum, s) => sum + s.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{isCashier ? "My sales" : "Sales"}</h2>
          <p>
            {isCashier
              ? "The last 50 sales you rang up. Open one to reprint the receipt."
              : "Your 50 most recent sales. Open one to reprint the receipt or void it."}
          </p>
        </div>
        <Link href="/pos" className="btn btn-primary">Open POS</Link>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Completed sales (shown)</div><div className="value">{completed.length}</div></div>
        <div className="stat"><div className="label">Revenue (shown)</div><div className="value">{formatMoney(revenue, business.currency)}</div></div>
      </div>

      <div className="table-wrap">
        {sales.length === 0 ? (
          <div className="empty">No sales yet. <Link href="/pos"><strong>Make your first sale</strong></Link>.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Receipt</th><th>When</th><th>Payment</th><th className="num">Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/sales/${s.id}`}>{s.receipt_no ?? "-"}</Link></td>
                  <td><LocalTime iso={s.created_at} /></td>
                  <td>{METHOD_LABEL[s.payments[0]?.method] ?? "-"}</td>
                  <td className="num">{formatMoney(s.total, business.currency)}</td>
                  <td>
                    <span className={`chip${s.status === "completed" ? "" : " warn"}`}>
                      {s.status === "completed" ? "Completed" : s.status === "voided" ? "Voided" : s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
