"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NumberInput from "@/components/NumberInput";

export type PoLine = { id: string; code: string; name: string; remaining: number };

export default function ReceivePoForm({ poId, lines, partial }: { poId: string; lines: PoLine[]; partial: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = lines.filter((l) => l.remaining > 0);

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = open
      .map((l) => ({ item_id: l.id, quantity: Number(qty[l.id] || 0), expiry_date: expiry[l.id] || null, batch_no: batch[l.id]?.trim() || null, line: l }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) return setError("Enter the quantity you received for at least one item.");
    for (const i of items) {
      if (!Number.isInteger(i.quantity) || i.quantity > i.line.remaining) return setError(`${i.line.name}: only ${i.line.remaining} left to receive.`);
      if (i.expiry_date && i.expiry_date < date) return setError(`${i.line.name}: expiry date is earlier than the received date.`);
    }
    setLoading(true);
    const { error: rpcErr } = await supabase.rpc("receive_purchase_order", {
      p_po_id: poId, p_date_received: date,
      p_items: items.map(({ item_id, quantity, expiry_date, batch_no }) => ({ item_id, quantity, expiry_date, batch_no })),
    });
    setLoading(false);
    if (rpcErr) return setError(rpcErr.message);
    setQty({}); setExpiry({}); setBatch({});
    router.refresh();
  }

  async function close() {
    const msg = partial
      ? "Close this order? What has not arrived will no longer be expected."
      : "Cancel this purchase order? Nothing has been received for it.";
    if (!window.confirm(msg)) return;
    setLoading(true); setError(null);
    const { error: rpcErr } = await supabase.rpc("close_purchase_order", { p_po_id: poId });
    setLoading(false);
    if (rpcErr) return setError(rpcErr.message);
    router.refresh();
  }

  return (
    <form onSubmit={receive} className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Receive delivery</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Enter what arrived. Each line becomes a stock batch at the ordered cost, the same as Receiving. You can receive the rest later.
      </p>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="rc-date">Date received</label>
        <input id="rc-date" className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {open.map((l) => (
          <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 1fr 1fr", gap: 8, alignItems: "center" }}>
            <div>{l.name}<div className="muted" style={{ fontSize: 12 }}>{l.code} · {l.remaining} left</div></div>
            <NumberInput integer className="input" placeholder="Qty" aria-label={`${l.name} quantity received`} max={l.remaining}
              value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            <input className="input" type="date" aria-label={`${l.name} expiry date`} title="Expiry date (optional)" value={expiry[l.id] ?? ""}
              onChange={(e) => setExpiry({ ...expiry, [l.id]: e.target.value })} />
            <input className="input" placeholder="Batch no." aria-label={`${l.name} batch number`} maxLength={100} value={batch[l.id] ?? ""}
              onChange={(e) => setBatch({ ...batch, [l.id]: e.target.value })} />
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, String(l.remaining)])))} style={{ justifySelf: "start" }}>Fill all remaining</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={loading} type="submit">{loading ? "Saving..." : "Receive into stock"}</button>
        <button className="btn" type="button" disabled={loading} onClick={close} style={{ color: "var(--danger)" }}>
          {partial ? "Close order" : "Cancel order"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>New products are created without a selling price. Set it in Products so it can be sold.</p>
    </form>
  );
}
