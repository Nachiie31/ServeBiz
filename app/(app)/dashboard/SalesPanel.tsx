"use client";

import Link from "next/link";
import { useState } from "react";
import BarChart from "@/components/BarChart";
import RangeTabs from "@/components/RangeTabs";
import { useSalesByDay, type RangeDays } from "@/lib/sales-data";
import { formatMoney } from "@/lib/format";

export default function SalesPanel({ businessId, currency }: { businessId: string; currency: string }) {
  const [days, setDays] = useState<RangeDays>(30);
  const { rows, loading, error } = useSalesByDay(businessId, days);

  const income = rows?.reduce((s, r) => s + r.income, 0) ?? 0;
  const orders = rows?.reduce((s, r) => s + r.orders, 0) ?? 0;

  return (
    <section className="section">
      <div className="chart-head">
        <div>
          <h3>Sales</h3>
          <div className="sub">
            {rows
              ? `${formatMoney(income, currency)} from ${orders} order${orders === 1 ? "" : "s"} in the last ${days} days. Net of tax.`
              : "Net sales per day, before tax."}
          </div>
        </div>
        <RangeTabs value={days} onChange={setDays} />
      </div>

      <div className="chart-card">
        {error ? (
          <div className="alert err" role="alert" style={{ margin: 0 }}>{error}</div>
        ) : rows ? (
          <BarChart rows={rows} currency={currency} loading={loading} />
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
