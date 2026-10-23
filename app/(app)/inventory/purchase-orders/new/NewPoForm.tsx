"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NumberInput from "@/components/NumberInput";
import { formatMoney } from "@/lib/format";

type Line = { code: string; name: string; quantity: string; unit_cost: string };
const blank = (): Line => ({ code: "", name: "", quantity: "", unit_cost: "" });

export default function NewPoForm({
  businessId, currency, suppliers, products,
}: { businessId: string; currency: string; suppliers: { id: string; name: string }[]; products: { code: string; name: string }[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameByCode = new Map(products.map((p) => [p.code, p.name]));

  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const used = lines.filter((l) => l.code.trim() || l.name.trim() || l.quantity || l.unit_cost);
    if (used.length === 0) return setError("Add at least one item.");
    for (const [i, l] of used.entries()) {
      const n = `Item ${i + 1}`;
      if (!l.code.trim()) return setError(`${n}: enter the product code.`);
      if (!l.name.trim()) return setError(`${n}: enter the product name.`);
      if (!Number.isInteger(Number(l.quantity)) || Number(l.quantity) <= 0) return setError(`${n}: quantity must be a whole number above 0.`);
      if (l.unit_cost === "" || !(Number(l.unit_cost) >= 0)) return setError(`${n}: enter the cost per unit.`);
    }
    setLoading(true);
    const { data, error: rpcErr } = await supabase.rpc("create_purchase_order", {
      p_business_id: businessId,
      p_supplier_id: supplier || null,
      p_expected_date: expected || null,
      p_notes: notes.trim() || null,
      p_items: used.map((l) => ({ code: l.code.trim(), name: l.name.trim(), quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })),
    });
    if (rpcErr) {
      setLoading(false);
      return setError(rpcErr.message.includes("create_purchase_order") && rpcErr.message.includes("function")
        ? "Purchase orders need a database update. Run supabase/migrations/011_purchase_orders.sql in Supabase." : rpcErr.message);
    }
    router.push(`/inventory/purchase-orders/${data}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 860 }}>
      <datalist id="po-codes">{products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="po-supplier">Supplier</label>
          <select id="po-supplier" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">No supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="po-expected">Expected date <span className="hint">(optional)</span></label>
          <input id="po-expected" className="input" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </div>
      </div>

      <h3 style={{ margin: "8px 0" }}>Items</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.6fr 0.7fr 0.9fr auto", gap: 8, alignItems: "center" }}>
            <input className="input" list="po-codes" placeholder="Code" aria-label={`Item ${i + 1} code`} maxLength={64} value={l.code}
              onChange={(e) => { const code = e.target.value; set(i, { code, ...(nameByCode.has(code) && !l.name ? { name: nameByCode.get(code)! } : {}) }); }} />
            <input className="input" placeholder="Name" aria-label={`Item ${i + 1} name`} maxLength={200} value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
            <NumberInput integer className="input" placeholder="Qty" aria-label={`Item ${i + 1} quantity`} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            <NumberInput className="input" placeholder="Unit cost" aria-label={`Item ${i + 1} unit cost`} value={l.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} />
            <button type="button" className="btn" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, k) => k !== i))}>&times;</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0" }}>
        <button type="button" className="btn" disabled={lines.length >= 100} onClick={() => setLines([...lines, blank()])}>+ Add item</button>
        <strong>Total: {formatMoney(total, currency)}</strong>
      </div>

      <div className="field">
        <label htmlFor="po-notes">Notes <span className="hint">(optional)</span></label>
        <input id="po-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={loading} type="submit">{loading ? "Saving..." : "Create purchase order"}</button>
    </form>
  );
}
