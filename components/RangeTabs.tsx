"use client";

import { RANGES, type RangeDays } from "@/lib/sales-data";

export default function RangeTabs({ value, onChange }: { value: RangeDays; onChange: (d: RangeDays) => void }) {
  return (
    <div className="tabs" role="group" aria-label="Date range">
      {RANGES.map((d) => (
        <button
          key={d}
          type="button"
          className={`tab${value === d ? " active" : ""}`}
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          style={{ cursor: "pointer", font: "inherit", fontWeight: 600, fontSize: 14 }}
        >
          Last {d} days
        </button>
      ))}
    </div>
  );
}
