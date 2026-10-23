"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NumberInput from "@/components/NumberInput";

type Props = {
  productId: string;
  total: number;
  batches: { id: string; label: string }[];
};

export default function AdjustStockForm({ productId, total, batches }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [type, setType] = useState("damaged");
  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return setError("Quantity must be a whole number greater than 0.");
    if (type === "adjustment" && !reason.trim()) return setError("Please enter a reason.");

    setLoading(true);
    const { error: rpcErr } = await supabase.rpc("adjust_stock", {
      p_product_id: productId,
      p_type: type,
      p_quantity: qty,
      p_reason: reason.trim() || null,
      p_batch_id: batchId || null,
    });
    setLoading(false);

    if (rpcErr) {
      return setError(
        rpcErr.message.includes("adjust_stock")
          ? "The inventory functions are missing. Run supabase/migrations/002_inventory.sql in Supabase first."
          : rpcErr.message
      );
    }
    setDone(`Removed ${qty} unit${qty === 1 ? "" : "s"}.`);
    setQuantity("");
    setReason("");
    setBatchId("");
    router.refresh();
  }

  if (total === 0) {
    return <div className="alert warn">There is no stock to remove.</div>;
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert err" role="alert">{error}</div>}
      {done && <div className="alert">{done}</div>}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="type">Reason type</label>
          <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="damaged">Damaged</option>
            <option value="expired">Expired</option>
            <option value="adjustment">Lost / recount / other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="adj-qty">Quantity to remove</label>
          <NumberInput integer id="adj-qty" className="input" min={1} max={total} required
            value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="batch">From batch</label>
        <select id="batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">Earliest expiring first (automatic)</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="reason">
          Note {type === "adjustment" ? <span className="hint">(required)</span> : <span className="hint">(optional)</span>}
        </label>
        <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Dropped during stocking" />
      </div>

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Remove stock"}
      </button>
    </form>
  );
}
