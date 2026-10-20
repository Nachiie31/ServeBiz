"use client";

import { useEffect, useRef, useState } from "react";
import type { DayRow } from "@/lib/sales-data";
import { formatMoney } from "@/lib/format";

type Props = {
  rows: DayRow[];
  currency: string;
  loading?: boolean;
  /** Accessible name and table heading for the plotted measure. */
  measure?: string;
};

const HEIGHT = 260; // plot + x-axis band, so axis labels never get clipped
const PAD = { top: 22, right: 8, bottom: 28, left: 44 };
const MAX_BAR = 24;
const GAP = 2;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const shortDate = (day: string) => parseDay(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (day: string) =>
  parseDay(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Round the axis to clean numbers (about 4 intervals). */
function niceScale(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

/** Column with a 4px rounded top and a square base, growing from the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export default function BarChart({ rows, currency, loading = false, measure = "Net sales" }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = rows.length;
  const max = Math.max(0, ...rows.map((r) => r.income));
  const { top, step } = niceScale(max);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const yOf = (v: number) => PAD.top + plotH - (v / top) * plotH;

  // With no sales there is no scale to show, only the baseline.
  const ticks: number[] = [];
  if (max > 0) for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);
  else ticks.push(0);

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
  const peak = max > 0 ? rows.findIndex((r) => r.income === max) : -1;
  const total = rows.reduce((s, r) => s + r.income, 0);
  const empty = total === 0;

  const hovered = hover !== null ? rows[hover] : null;
  const hx = hover !== null ? PAD.left + slot * hover + slot / 2 : 0;
  const hy = hovered ? yOf(hovered.income) : 0;

  if (table) {
    return (
      <div>
        <div className="table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Date</th><th className="num">{measure}</th><th className="num">Orders</th></tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.day}>
                  <td>{longDate(r.day)}</td>
                  <td className="num">{formatMoney(r.income, currency)}</td>
                  <td className="num">{r.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="link-btn chart-toggle" onClick={() => setTable(false)}>Show chart</button>
      </div>
    );
  }

  return (
    <div>
      <div ref={boxRef} className={`chart-box${loading ? " loading" : ""}`} style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${measure} per day, ${n} days`}>
            {/* hairline grid + y ticks */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.left - 8} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
                  {compact.format(v)}
                </text>
              </g>
            ))}

            {/* bars */}
            {rows.map((r, i) => {
              if (r.income <= 0) return null;
              const x = PAD.left + slot * i + (slot - barW) / 2;
              const y = yOf(r.income);
              const dim = hover !== null && hover !== i;
              return (
                <path
                  key={r.day}
                  d={barPath(x, y, barW, PAD.top + plotH - y)}
                  fill="var(--chart-1)"
                  opacity={dim ? 0.45 : 1}
                />
              );
            })}

            {/* the peak, labeled once */}
            {peak >= 0 && hover === null && (() => {
              const cx = PAD.left + slot * peak + slot / 2;
              const anchor = cx < PAD.left + 28 ? "start" : cx > width - PAD.right - 28 ? "end" : "middle";
              return (
                <text x={anchor === "start" ? cx - barW / 2 : anchor === "end" ? cx + barW / 2 : cx} y={yOf(max) - 6}
                  textAnchor={anchor} fontSize={11} fontWeight={600} fill="var(--ink)">
                  {compact.format(max)}
                </text>
              );
            })()}

            {/* x labels */}
            {rows.map((r, i) => {
              if ((n - 1 - i) % labelEvery !== 0) return null;
              const cx = PAD.left + slot * i + slot / 2;
              // Keep the newest label inside the chart instead of being cut off at the edge.
              const nearEdge = cx > width - PAD.right - 22;
              return (
                <text key={r.day} x={nearEdge ? width - PAD.right : cx} y={HEIGHT - 8}
                  textAnchor={nearEdge ? "end" : "middle"} fontSize={11} fill="var(--muted)">
                  {shortDate(r.day)}
                </text>
              );
            })}

            {/* hit targets: full-height slots, bigger than the bars */}
            {rows.map((r, i) => (
              <rect
                key={`hit-${r.day}`}
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={n <= 31 ? 0 : -1}
                aria-label={`${longDate(r.day)}: ${formatMoney(r.income, currency)}, ${r.orders} order${r.orders === 1 ? "" : "s"}`}
                onPointerEnter={() => setHover(i)}
                onPointerMove={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ outline: "none" }}
              />
            ))}
          </svg>
        )}

        {hovered && (
          <div
            className="chart-tip"
            style={{ left: Math.min(Math.max(hx, 80), Math.max(80, width - 80)), top: Math.max(0, hy - 66) }}
            role="status"
          >
            <strong>{formatMoney(hovered.income, currency)}</strong>
            <span>{longDate(hovered.day)}</span>
            <span>{hovered.orders} order{hovered.orders === 1 ? "" : "s"}</span>
          </div>
        )}

        {empty && width > 0 && (
          <div className="chart-empty">No sales in this period yet.</div>
        )}
      </div>
      <button type="button" className="link-btn chart-toggle" onClick={() => setTable(true)}>Show as table</button>
    </div>
  );
}
