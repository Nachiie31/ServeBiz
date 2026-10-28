"use client";

import Link from "next/link";
import { useState } from "react";
import BarChart from "@/components/BarChart";
import RangeTabs from "@/components/RangeTabs";
import { useSalesByDay, type RangeDays } from "@/lib/sales-data";
import { busiestWeekday, change, changeLabel, splitPeriods, summarize, type Change } from "@/lib/trends";
import { formatMoney } from "@/lib/format";

function Delta({ c, days }: { c: Change; days: number }) {
  if (c.kind === "none") return <div className="sub">No sales in either period</div>;
  return (
    <div className="sub">
      <span className={`chip${c.kind === "down" ? " warn" : " gray"}`}>{changeLabel(c)}</span> vs previous {days} days
    </div>
  );
}

export default function SalesPanel({ businessId, currency }: { businessId: string; currency: string }) {
  const [days, setDays] = useState<RangeDays>(30);
  // Load twice the range so this period can be compared with the one before it.
  const { rows: all, loading, error } = useSalesByDay(businessId, days * 2);
  const periods = all ? splitPeriods(all, days) : null;

  const cur = periods ? summarize(periods.current) : null;
  const prev = periods ? summarize(periods.previous) : null;
  const money = (n: number) => formatMoney(n, currency);

  const incomeChange = cur && prev ? change(cur.income, prev.income) : null;
  const headline =
    incomeChange?.kind === "up" ? `Sales are up ${incomeChange.pct.toFixed(1)}% compared with the previous ${days} days.`
    : incomeChange?.kind === "down" ? `Sales are down ${Math.abs(incomeChange.pct).toFixed(1)}% compared with the previous ${days} days.`
    : incomeChange?.kind === "flat" ? `Sales are level with the previous ${days} days.`
    : incomeChange?.kind === "new" ? `No sales in the previous ${days} days, so this period is all new.`
    : "Net sales per day, before tax.";
  const weekday = periods ? busiestWeekday(periods.current) : null;

  return (
    <section className="section">
      <div className="chart-head">
        <div>
          <h3>Sales trends</h3>
          <div className="sub">{headline}</div>
        </div>
        <RangeTabs value={days} onChange={setDays} />
      </div>

      {cur && prev && !error && (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat">
            <div className="label">Net sales</div>
            <div className="value">{money(cur.income)}</div>
            <Delta c={change(cur.income, prev.income)} days={days} />
          </div>
          <div className="stat">
            <div className="label">Orders</div>
            <div className="value">{cur.orders}</div>
            <Delta c={change(cur.orders, prev.orders)} days={days} />
          </div>
          <div className="stat">
            <div className="label">Average order</div>
            <div className="value">{money(cur.avgOrder)}</div>
            <Delta c={change(cur.avgOrder, prev.avgOrder)} days={days} />
          </div>
          <div className="stat">
            <div className="label">Best day</div>
            <div className="value">{cur.best ? money(cur.best.income) : "-"}</div>
            <div className="sub">
              {cur.best
                ? new Date(Number(cur.best.day.slice(0, 4)), Number(cur.best.day.slice(5, 7)) - 1, Number(cur.best.day.slice(8, 10))).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
                : "No sales yet"}
            </div>
          </div>
          {days >= 30 && (
            <div className="stat">
              <div className="label">Busiest weekday</div>
              <div className="value">{weekday ? weekday.name : "-"}</div>
              <div className="sub">{weekday ? `${money(weekday.avg)} on average` : "No sales yet"}</div>
            </div>
          )}
        </div>
      )}

      <div className="chart-card">
        {error ? (
          <div className="alert err" role="alert" style={{ margin: 0 }}>{error}</div>
        ) : periods ? (
          <BarChart rows={periods.current} currency={currency} loading={loading} averageWindow={days >= 30 ? 7 : 0} />
        ) : (
          <div style={{ height: 260 }} className="chart-empty" aria-busy="true">Loading sales...</div>
        )}
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        More detail, profit, and top products in <Link href="/reports" style={{ color: "var(--brand)", fontWeight: 600 }}>Reports</Link>.
      </div>
    </section>
  );
}
