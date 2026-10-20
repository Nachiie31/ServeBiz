"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BarChart from "@/components/BarChart";
import RangeTabs from "@/components/RangeTabs";
import { createClient } from "@/lib/supabase/client";
import { useSalesByDay, viewerTimeZone, type RangeDays } from "@/lib/sales-data";
import { formatMoney } from "@/lib/format";

type TopProduct = { product_id: string; name: string; units: number; sales: number; profit: number };

export default function ReportsClient({ businessId, currency }: { businessId: string; currency: string }) {
  const [days, setDays] = useState<RangeDays>(30);
  const { rows, loading, error } = useSalesByDay(businessId, days);

  const [top, setTop] = useState<TopProduct[] | null>(null);
  const [topLoading, setTopLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setTopLoading(true);
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc("top_products", {
        p_business_id: businessId,
        p_days: days,
        p_tz: viewerTimeZone(),
      });
      if (cancelled) return;
      if (rpcErr) {
        setTopError(rpcErr.message);
      } else {
        setTopError(null);
        setTop(
          ((data ?? []) as TopProduct[]).map((r) => ({
            ...r,
            units: Number(r.units),
            sales: Number(r.sales),
            profit: Number(r.profit),
          }))
        );
      }
      setTopLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, days]);

  const money = (n: number) => formatMoney(n, currency);
  const income = rows?.reduce((s, r) => s + r.income, 0) ?? 0;
  const cost = rows?.reduce((s, r) => s + r.cost, 0) ?? 0;
  const orders = rows?.reduce((s, r) => s + r.orders, 0) ?? 0;
  const profit = income - cost;
  const margin = income > 0 ? (profit / income) * 100 : 0;
  const avg = orders > 0 ? income / orders : 0;

  return (
    <>
      {/* One filter row above everything it scopes */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <RangeTabs value={days} onChange={setDays} />
      </div>

      {error && <div className="alert err" role="alert">{error}</div>}

      <div className={`stats${loading ? " chart-box loading" : ""}`}>
        <div className="stat"><div className="label">Net sales</div><div className="value">{money(income)}</div><div className="sub">after discounts, before tax</div></div>
        <div className="stat"><div className="label">Orders</div><div className="value">{orders}</div><div className="sub">avg {money(avg)}</div></div>
        <div className="stat"><div className="label">Cost of goods</div><div className="value">{money(cost)}</div><div className="sub">what the sold items cost you</div></div>
        <div className="stat"><div className="label">Profit</div><div className="value">{money(profit)}</div><div className="sub">{income > 0 ? `${margin.toFixed(1)}% margin` : "no sales yet"}</div></div>
      </div>

      <section className="section">
        <div className="chart-head">
          <div>
            <h3>Net sales per day</h3>
            <div className="sub">Hover or focus a day for the amount. Net of tax.</div>
          </div>
        </div>
        <div className="chart-card">
          {rows ? <BarChart rows={rows} currency={currency} loading={loading} /> : <div style={{ height: 260 }} className="chart-empty">Loading sales...</div>}
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: 10 }}>Top products</h3>
        {topError && <div className="alert err" role="alert">{topError}</div>}
        <div className={`table-wrap${topLoading ? " chart-box loading" : ""}`}>
          {!top || top.length === 0 ? (
            <div className="empty">{topLoading ? "Loading..." : "No product sales in this period yet."}</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Product</th><th className="num">Units sold</th><th className="num">Sales</th><th className="num">Profit</th></tr>
              </thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.product_id}>
                    <td><Link href={`/inventory/products/${p.product_id}`}>{p.name}</Link></td>
                    <td className="num">{p.units}</td>
                    <td className="num">{money(p.sales)}</td>
                    <td className="num">{money(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Product sales and profit are at selling price, before any sale-wide discount. Top 10 by sales.
        </div>
      </section>
    </>
  );
}
