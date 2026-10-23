import Link from "next/link";
import { getAllMemberships, getMembership } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { selectBusiness } from "../businesses/actions";

type Row = {
  business_id: string; branch_name: string; income: number | string; orders: number | string; cost: number | string;
  units_in_stock: number | string; inventory_value: number | string; low_stock: number; out_of_stock: number;
};

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range = "30" } = await searchParams;
  const sel = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const { business } = (await getMembership())!;
  const all = await getAllMemberships();
  const supabase = await createClient();

  if (!business.organization_id) {
    return <div className="alert warn">Run <code>supabase/migrations/008_branches.sql</code> and <code>009_audit_overview.sql</code>, then refresh.</div>;
  }
  const { data, error } = await supabase.rpc("org_overview", { p_org: business.organization_id, p_days: sel.days });
  if (error) {
    return <div className="alert warn">The overview needs <code>supabase/migrations/009_audit_overview.sql</code>. Run it in the Supabase SQL Editor, then refresh. ({error.message})</div>;
  }
  const rows = (data ?? []) as Row[];
  const currencyOf = new Map(all.map((e) => [e.business.id, e.business.currency]));
  const currencies = new Set(rows.map((r) => currencyOf.get(r.business_id) ?? "PHP"));
  const single = currencies.size === 1 ? [...currencies][0] : null;
  const fmt = (r: Row, v: number | string) => formatMoney(Number(v), currencyOf.get(r.business_id) ?? "PHP");

  const sum = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const income = sum("income"), cost = sum("cost");
  const maxIncome = Math.max(...rows.map((r) => Number(r.income)), 0);
  const orgName = all.find((e) => e.business.id === business.id)?.organizationName ?? business.name;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>All branches</h2>
          <p>{orgName}: sales and stock for the branches you own, side by side. Income is net of tax.</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {RANGES.map((r) => (
          <Link key={r.key} href={`/overview?range=${r.key}`} className={`tab${sel.key === r.key ? " active" : ""}`}>{r.label}</Link>
        ))}
      </div>

      {!single && rows.length > 1 && (
        <div className="alert warn">Your branches use different currencies, so combined totals are not shown.</div>
      )}

      {single && (
        <div className="stats">
          <div className="stat"><div className="label">Income</div><div className="value">{formatMoney(income, single)}</div></div>
          <div className="stat"><div className="label">Orders</div><div className="value">{sum("orders")}</div></div>
          <div className="stat"><div className="label">Profit (income - cost)</div><div className="value">{formatMoney(income - cost, single)}</div></div>
          <div className="stat"><div className="label">Inventory value</div><div className="value">{formatMoney(sum("inventory_value"), single)}</div></div>
        </div>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">No branches to show.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Branch</th><th className="num">Income</th><th className="num">Orders</th><th className="num">Profit</th>
                <th className="num">Units in stock</th><th className="num">Stock value</th><th className="num">Low</th><th className="num">Out</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.business_id}>
                  <td>
                    <strong>{r.branch_name}</strong>
                    {r.business_id === business.id && <span className="badge" style={{ marginLeft: 8 }}>Current</span>}
                    {maxIncome > 0 && (
                      <div aria-hidden style={{ height: 4, borderRadius: 2, background: "var(--brand)", opacity: 0.8, marginTop: 6, width: `${Math.max(2, (Number(r.income) / maxIncome) * 100)}%` }} />
                    )}
                  </td>
                  <td className="num">{fmt(r, r.income)}</td>
                  <td className="num">{Number(r.orders)}</td>
                  <td className="num">{fmt(r, Number(r.income) - Number(r.cost))}</td>
                  <td className="num">{Number(r.units_in_stock)}</td>
                  <td className="num">{fmt(r, r.inventory_value)}</td>
                  <td className="num">{r.low_stock}</td>
                  <td className="num">{r.out_of_stock}</td>
                  <td>
                    {r.business_id !== business.id && (
                      <form action={selectBusiness}>
                        <input type="hidden" name="business_id" value={r.business_id} />
                        <button className="btn" type="submit">Open</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Only branches where you are the owner are included. Managers and cashiers never see other branches&apos; figures.
      </p>
    </>
  );
}
