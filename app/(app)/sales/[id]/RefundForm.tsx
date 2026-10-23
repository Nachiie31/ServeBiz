"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NumberInput from "@/components/NumberInput";

export type RefundLine = { id: string; name: string; sold: number; returned: number };

export default function RefundForm({ saleId, lines }: { saleId: string; lines: RefundLine[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundable = lines.filter((l) => l.sold - l.returned > 0);
  if (refundable.length === 0) return null;

  const chosen = refundable
    .map((l) => ({ line: l, n: Number(qty[l.id] || 0) }))
    .filter((c) => c.n > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const c of chosen) {
      const max = c.line.sold - c.line.returned;
      if (!Number.isInteger(c.n) || c.n > max) return setError(`${c.line.name}: you can refund at most ${max}.`);
    }
    if (chosen.length === 0) return setError("Enter a quantity for at least one item.");
    if (!window.confirm("Refund these items? They go back into stock. Hand the money back to the customer yourself.")) return;

    setLoading(true);
    const { error: rpcErr } = await supabase.rpc("refund_sale", {
      p_sale_id: saleId,
      p_items: chosen.map((c) => ({ sale_item_id: c.line.id, quantity: c.n })),
      p_reason: reason.trim() || null,
    });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message.includes("refund_sale") && rpcErr.message.includes("function")
        ? "Refunds need a database update. Run supabase/migrations/010_refunds.sql in Supabase, then try again."
        : rpcErr.message);
      return;
    }
    setOpen(false); setQty({}); setReason("");
    router.refresh();
  }

  if (!open) {
    return <button className="btn" type="button" onClick={() => setOpen(true)}>Refund items</button>;
  }

  return (
    <form onSubmit={submit} className="card" style={{ marginTop: 14, flexBasis: "100%" }}>
      <h3 style={{ marginTop: 0 }}>Refund items</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {refundable.map((l) => {
          const max = l.sold - l.returned;
          return (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <label htmlFor={`rf-${l.id}`}>
                {l.name}
                <span className="muted" style={{ fontSize: 13 }}> (up to {max})</span>
              </label>
              <NumberInput integer id={`rf-${l.id}`} className="input" style={{ width: 90 }} min={0} max={max}
                value={qty[l.id] ?? ""} placeholder="0" onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </div>
          );
        })}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="rf-reason">Reason <span className="hint">(optional)</span></label>
        <input id="rf-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Discount and tax are refunded in proportion. Returned items go back into stock. The money is not moved for you: give cash back, or refund online payments in your Stripe dashboard.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={loading || chosen.length === 0} type="submit">{loading ? "Refunding..." : "Refund selected"}</button>{" "}
      <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
