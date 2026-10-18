"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayISO } from "@/lib/format";
import type { Supplier } from "@/lib/types";

type Props = {
  businessId: string;
  suppliers: Supplier[];
  products: { code: string; name: string; selling_price: number }[];
};

const NEW_SUPPLIER = "__new";

export default function ReceivingForm({ businessId, suppliers, products }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [dateReceived, setDateReceived] = useState(todayISO());
  const [expiry, setExpiry] = useState("");
  const [quantity, setQuantity] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ text: string; code: string } | null>(null);

  const existing = products.find((p) => p.code.toLowerCase() === code.trim().toLowerCase());
  const alreadyPriced = !!existing && existing.selling_price > 0;
  const costNum = Number(basePrice);
  const sellNum = Number(sellingPrice);
  const belowCost = sellingPrice !== "" && basePrice !== "" && sellNum > 0 && sellNum < costNum;

  function applyMarkup(percent: number) {
    if (basePrice === "" || !(costNum > 0)) return;
    setSellingPrice((Math.round(costNum * (1 + percent / 100) * 100) / 100).toString());
  }

  function onCodeChange(value: string) {
    setCode(value);
    const match = products.find((p) => p.code.toLowerCase() === value.trim().toLowerCase());
    if (match) setName(match.name);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const qty = Number(quantity);
    const price = Number(basePrice);
    if (!Number.isInteger(qty) || qty <= 0) return setError("Quantity must be a whole number greater than 0.");
    if (!(price >= 0) || basePrice === "") return setError("Enter the base (cost) price per unit.");
    if (expiry && expiry < dateReceived) return setError("Expiry date is earlier than the date received.");

    setLoading(true);

    let supplier: string | null = supplierId && supplierId !== NEW_SUPPLIER ? supplierId : null;
    if (supplierId === NEW_SUPPLIER) {
      if (!newSupplier.trim()) {
        setLoading(false);
        return setError("Enter the new supplier's name or pick an existing one.");
      }
      const { data, error: supErr } = await supabase
        .from("suppliers")
        .insert({ business_id: businessId, name: newSupplier.trim() })
        .select("id")
        .single();
      if (supErr || !data) {
        setLoading(false);
        return setError(supErr?.message ?? "Could not create supplier.");
      }
      supplier = data.id;
    }

    const { data: batchId, error: rpcErr } = await supabase.rpc("receive_stock", {
      p_business_id: businessId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_supplier_id: supplier,
      p_date_received: dateReceived,
      p_expiry_date: expiry || null,
      p_quantity: qty,
      p_base_price: price,
      p_batch_no: batchNo.trim() || null,
      p_notes: notes.trim() || null,
    });

    if (rpcErr) {
      setLoading(false);
      return setError(
        rpcErr.message.includes("receive_stock")
          ? "The inventory functions are missing. Run supabase/migrations/002_inventory.sql in Supabase first."
          : rpcErr.message
      );
    }

    // Optional selling price: only applied when the product has no price yet.
    let priced = false;
    if (sellNum > 0 && !alreadyPriced && batchId) {
      const { data: b } = await supabase
        .from("stock_batches")
        .select("product_id,products(selling_price)")
        .eq("id", batchId)
        .single();
      const row = b as unknown as { product_id: string; products: { selling_price: number } | null } | null;
      if (row && (row.products?.selling_price ?? 0) <= 0) {
        const { error: priceErr } = await supabase
          .from("products")
          .update({ selling_price: sellNum, is_active: true })
          .eq("id", row.product_id);
        priced = !priceErr;
      }
    }

    setSuccess({
      text: `Received ${qty} unit${qty === 1 ? "" : "s"} of ${name.trim() || code.trim()}.${priced ? " Price set, ready to sell in the POS." : alreadyPriced ? "" : " Set its selling price in Products to sell it."}`,
      code: code.trim(),
    });
    setCode(""); setName(""); setQuantity(""); setBasePrice(""); setSellingPrice(""); setBatchNo(""); setNotes(""); setExpiry("");
    setSupplierId(""); setNewSupplier("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <datalist id="product-codes">
        {products.map((p) => (
          <option key={p.code} value={p.code}>{p.name}</option>
        ))}
      </datalist>

      {error && <div className="alert err" role="alert">{error}</div>}
      {success && (
        <div className="alert">
          {success.text} <Link href="/inventory/products"><strong>Review products and set selling prices</strong></Link>
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="code">Product code / SKU</label>
          <input id="code" className="input" required list="product-codes" value={code}
            onChange={(e) => onCodeChange(e.target.value)} placeholder="e.g. SKU-0001" autoComplete="off" />
          <span className="hint">
            {existing ? "Existing product: this adds a new batch to its stock." : code.trim() ? "New code: a new product will be created." : "Pick an existing code or type a new one."}
          </span>
        </div>

        <div className="field">
          <label htmlFor="pname">Product name</label>
          <input id="pname" className="input" required value={name} onChange={(e) => setName(e.target.value)}
            readOnly={!!existing} />
        </div>

        <div className="field">
          <label htmlFor="supplier">Supplier</label>
          <select id="supplier" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value={NEW_SUPPLIER}>+ Add new supplier...</option>
          </select>
          {supplierId === NEW_SUPPLIER && (
            <input className="input" style={{ marginTop: 8 }} placeholder="New supplier name"
              value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
          )}
        </div>

        <div className="field">
          <label htmlFor="batch">Batch / lot no. <span className="hint">(optional)</span></label>
          <input id="batch" className="input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="received">Date received</label>
          <input id="received" className="input" type="date" required value={dateReceived}
            onChange={(e) => setDateReceived(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="expiry">Expiry date <span className="hint">(leave blank if none)</span></label>
          <input id="expiry" className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="qty">Quantity received</label>
          <input id="qty" className="input" type="number" min={1} step={1} required value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="price">Base price per unit (your cost)</label>
          <input id="price" className="input" type="number" min={0} step="0.01" required value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="sell">Selling price per unit <span className="hint">(optional)</span></label>
          {alreadyPriced ? (
            <input id="sell" className="input" value={`Already priced at ${existing!.selling_price}`} readOnly />
          ) : (
            <>
              <input id="sell" className="input" type="number" min={0} step="0.01" value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)} placeholder="Set now or later in Products" />
              <span className="hint">
                Markup on cost:{" "}
                {[20, 30, 50].map((m) => (
                  <button key={m} type="button" className="link-btn" style={{ marginRight: 8 }} onClick={() => applyMarkup(m)}>+{m}%</button>
                ))}
              </span>
            </>
          )}
          {belowCost && <span className="hint" style={{ color: "var(--danger)" }}>Below your cost, so each sale would lose money.</span>}
        </div>

        <div className="field full">
          <label htmlFor="notes">Notes <span className="hint">(optional)</span></label>
          <input id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Record delivery"}
      </button>
    </form>
  );
}
