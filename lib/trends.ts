import type { DayRow } from "@/lib/sales-data";

export type PeriodSummary = {
  income: number;
  orders: number;
  /** income per order, 0 when there were no orders */
  avgOrder: number;
  best: DayRow | null;
};

export function summarize(rows: DayRow[]): PeriodSummary {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  let best: DayRow | null = null;
  for (const r of rows) if (r.income > 0 && (!best || r.income > best.income)) best = r;
  return { income, orders, avgOrder: orders > 0 ? income / orders : 0, best };
}

/** `rows` holds 2 x days of data, oldest first: the first half is the previous period. */
export function splitPeriods(rows: DayRow[], days: number): { current: DayRow[]; previous: DayRow[] } | null {
  if (rows.length !== days * 2) return null;
  return { previous: rows.slice(0, days), current: rows.slice(days) };
}

export type Change = { kind: "up" | "down" | "flat" | "new" | "none"; pct: number };

/** Percent change from `prev` to `cur`. "new" when there was nothing before, "none" when neither period had any. */
export function change(cur: number, prev: number): Change {
  if (prev <= 0 && cur <= 0) return { kind: "none", pct: 0 };
  if (prev <= 0) return { kind: "new", pct: 0 };
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return { kind: "flat", pct: 0 };
  return { kind: pct > 0 ? "up" : "down", pct };
}

/** Trailing average of income over `window` days; null until a full window exists. */
export function movingAverage(rows: DayRow[], window: number): (number | null)[] {
  return rows.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k++) sum += rows[k].income;
    return sum / window;
  });
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The weekday with the highest average income per day over the period, or null with no sales. */
export function busiestWeekday(rows: DayRow[]): { name: string; avg: number } | null {
  const sum = new Array(7).fill(0);
  const cnt = new Array(7).fill(0);
  for (const r of rows) {
    const [y, m, d] = r.day.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    sum[wd] += r.income;
    cnt[wd] += 1;
  }
  let bestIdx = -1;
  let bestAvg = 0;
  for (let i = 0; i < 7; i++) {
    if (cnt[i] === 0) continue;
    const avg = sum[i] / cnt[i];
    if (avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }
  return bestIdx < 0 ? null : { name: WEEKDAYS[bestIdx], avg: bestAvg };
}

export function changeLabel(c: Change): string {
  switch (c.kind) {
    case "up": return `▲ ${c.pct.toFixed(1)}%`;
    case "down": return `▼ ${Math.abs(c.pct).toFixed(1)}%`;
    case "flat": return "No change";
    case "new": return "New";
    default: return "No sales";
  }
}
