"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import type { TaxSettings } from "@/lib/business";
import NumberInput from "@/components/NumberInput";

export default function TaxForm({ businessId, initial }: { businessId: string; initial: TaxSettings }) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(initial.name);
  const [rate, setRate] = useState(String(initial.rate));
  const [inclusive, setInclusive] = useState(initial.inclusive);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rateNum = Number(rate || 0);

  // A worked example so it is obvious what the two options do. Uses a 100.00 item.
  const example = (() => {
    if (!(rateNum > 0)) return null;
    const price = 100;
    const tax = inclusive ? (price * rateNum) / (100 + rateNum) : (price * rateNum) / 100;
    const total = inclusive ? price : price + tax;
    return { price, tax: Math.round(tax * 100) / 100, total: Math.round(total * 100) / 100 };
  })();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!(rateNum >= 0 && rateNum <= 100)) return setError("Tax rate must be between 0 and 100.");
    if (!name.trim()) return setError("Give the tax a name, for example VAT or Sales tax.");

    setLoading(true);
    const { error: updErr } = await supabase
      .from("businesses")
      .update({ tax_rate: rateNum, tax_name: name.trim(), tax_inclusive: inclusive })
      .eq("id", businessId);
    setLoading(false);

    if (updErr) {
      return setError(
        updErr.message.includes("tax_name") || updErr.message.includes("tax_inclusive")
          ? "Tax settings need an update first. Run supabase/migrations/005_reports_tax.sql in Supabase, then try again."
          : updErr.message
      );
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {!initial.migrated && (
        <div className="alert warn">
          Run <code>supabase/migrations/005_reports_tax.sql</code> in Supabase to unlock the tax name and &quot;prices include tax&quot; option.
        </div>
      )}
      {error && <div className="alert err" role="alert">{error}</div>}
      {saved && <div className="alert">Tax saved. It applies to your next sale.</div>}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="tax-name">Tax name</label>
          <input id="tax-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VAT" />
        </div>
        <div className="field">
          <label htmlFor="tax-rate">Rate (%)</label>
          <NumberInput id="tax-rate" className="input" min={0} max={100} step="0.01" value={rate}
            onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, padding: 0 }}>How are your selling prices set?</legend>
        <label className="check" style={{ marginBottom: 6 }}>
          <input type="radio" name="inclusive" checked={!inclusive} onChange={() => setInclusive(false)} />
          Tax is added on top of the price
        </label>
        <label className="check" style={{ marginBottom: 0 }}>
          <input type="radio" name="inclusive" checked={inclusive} onChange={() => setInclusive(true)} />
          Prices already include tax
        </label>
      </fieldset>

      {example && (
        <div className="alert" style={{ fontSize: 13 }}>
          Example: a {formatMoney(example.price)} item {inclusive ? "already contains" : "gets"}{" "}
          {formatMoney(example.tax)} {name.trim() || "tax"}, so the customer pays {formatMoney(example.total)}.
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save tax"}
      </button>
    </form>
  );
}
