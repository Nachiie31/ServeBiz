"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  productId: string;
  price: number;
  isActive: boolean;
  latestCost: number | null;
};

/** Edit a selling price right in the product list. Pricing a new product also activates it. */
export default function QuickPrice({ productId, price, isActive, latestCost }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [value, setValue] = useState(price > 0 ? String(price) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = Number(value);
  const changed = value !== "" && num > 0 && num !== price;
  const belowCost = latestCost !== null && num > 0 && num < latestCost;

  async function save() {
    setError(null);
    if (!(num > 0)) return setError("Enter a price above 0.");
    setSaving(true);
    // Only auto-activate products that had no price yet; keep deliberate deactivation intact.
    const patch: { selling_price: number; is_active?: boolean } = { selling_price: num };
    if (price <= 0) patch.is_active = true;
    const { error: updErr } = await supabase.from("products").update(patch).eq("id", productId);
    setSaving(false);
    if (updErr) return setError(updErr.message);
    router.refresh();
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "inline-flex", gap: 6 }}>
        <input
          className="input"
          style={{ width: 96, padding: "6px 8px", textAlign: "right" }}
          type="number" min={0} step="0.01"
          value={value}
          placeholder={latestCost !== null ? `cost ${latestCost}` : "0.00"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && changed) { e.preventDefault(); void save(); } }}
          aria-label="Selling price"
        />
        {(changed || (!isActive && num > 0)) && (
          <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={saving}>
            {saving ? "..." : price <= 0 ? "Set" : "Save"}
          </button>
        )}
      </div>
      {belowCost && <span className="hint" style={{ color: "var(--danger)", fontSize: 12 }}>Below cost</span>}
      {error && <span className="hint" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
