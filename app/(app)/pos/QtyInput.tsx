"use client";

import { useEffect, useState } from "react";

/**
 * Quantity box for a cart line: type a number, or use the - / + buttons around it.
 * Digits only, clamped to the stock on hand. Emptying the box and leaving it restores the old value.
 */
export default function QtyInput({
  value, max, label, onChange,
}: { value: number; max: number; label: string; onChange: (qty: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]); // buttons or stock clamp changed it

  function commit(text: string) {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(n, max);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <input
      className="qty-input"
      inputMode="numeric"
      autoComplete="off"
      aria-label={`${label} quantity (max ${max})`}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
        setDraft(digits);
        const n = parseInt(digits, 10);
        if (Number.isFinite(n) && n >= 1) {
          const clamped = Math.min(n, max);
          if (clamped !== n) setDraft(String(clamped));
          if (clamped !== value) onChange(clamped); // totals update while typing
        }
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}
