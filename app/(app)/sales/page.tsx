import Link from "next/link";
import { getMembership } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { redirect } from "next/navigation";
import Paginator from "@/components/Paginator";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";
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

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const { business, role } = (await getMembership())!;
  const isCashier = role === "cashier";
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await supabase
    .from("sales")
    .select("id,receipt_no,created_at,total,status,payments(method)", { count: "exact" })
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;
  if (page > 1 && page > pageCount(total)) redirect(`/sales${pageCount(total) > 1 ? `?page=${pageCount(total)}` : ""}`);

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
              ? "Sales you rang up, newest first. Open one to reprint the receipt."
              : "All sales, newest first. Open one to reprint the receipt or void it."}
          </p>
        </div>
        <div className="head-actions">
          <a href="/api/export/sales" className="btn" download>Export CSV</a>
          <Link href="/pos" className="btn btn-primary">Open POS</Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Completed (this page)</div><div className="value">{completed.length}</div></div>
        <div className="stat"><div className="label">Revenue (this page)</div><div className="value">{formatMoney(revenue, business.currency)}</div></div>
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
                      {s.status === "completed" ? "Completed" : s.status === "voided" ? "Voided" : s.status === "refunded" ? "Refunded" : s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Paginator basePath="/sales" page={page} total={total} pageSize={PAGE_SIZE} noun="sales" />
    </>
  );
}
