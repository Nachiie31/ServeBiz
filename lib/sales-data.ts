"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type DayRow = {
  day: string; // YYYY-MM-DD in the viewer's timezone
  income: number; // net sales: what customers paid minus tax
  orders: number;
  cost: number; // what the sold items cost you
};

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

/** The viewer's timezone, so "today" and each day's bucket match their clock, not the server's. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Loads daily sales for the last `days` days. While a new range loads, the previous rows stay
 * (so the chart can fade instead of flashing empty).
 */
export function useSalesByDay(businessId: string, days: number) {
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: rpcErr } = await supabase.rpc("sales_by_day", {
        p_business_id: businessId,
        p_days: days,
        p_tz: viewerTimeZone(),
      });
      if (cancelled) return;
      if (rpcErr) {
        setError(
          rpcErr.message.includes("sales_by_day")
            ? "Sales reports need a database update. Run supabase/migrations/005_reports_tax.sql in Supabase, then refresh."
            : rpcErr.message
        );
      } else {
        setRows(
          ((data ?? []) as { day: string; income: number; orders: number; cost: number }[]).map((r) => ({
            day: r.day,
            income: Number(r.income),
            orders: Number(r.orders),
            cost: Number(r.cost),
          }))
        );
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, days]);

  return { rows, loading, error };
}
