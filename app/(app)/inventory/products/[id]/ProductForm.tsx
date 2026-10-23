"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import type { Category, Product } from "@/lib/types";
import NumberInput from "@/components/NumberInput";

const NEW_CATEGORY = "__new";
const UNITS = ["pc", "pack", "box", "kg", "g", "L", "mL", "bottle", "can", "set"];

type Props = {
  businessId: string;
  product: Product;
  categories: Category[];
  latestCost: number | null;
  currency: string;
};

export default function ProductForm({ businessId, product, categories, latestCost, currency }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(product.name);
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [categoryId, setCategoryId] = useState(product.category_id ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [unit, setUnit] = useState(product.unit);
  const [price, setPrice] = useState(product.selling_price > 0 ? String(product.selling_price) : "");
  const [reorder, setReorder] = useState(String(product.reorder_level));
  const [isActive, setIsActive] = useState(product.is_active);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const priceNum = Number(price);
  const belowCost = latestCost !== null && price !== "" && priceNum > 0 && priceNum < latestCost;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!name.trim()) return setError("Product name is required.");
    if (price !== "" && !(priceNum >= 0)) return setError("Selling price cannot be negative.");
    if (isActive && !(priceNum > 0)) return setError("Set a selling price above 0 before marking the product active.");
    const reorderNum = Number(reorder || 0);
    if (!Number.isInteger(reorderNum) || reorderNum < 0) return setError("Reorder level must be a whole number, 0 or more.");

    setLoading(true);

    let category: string | null = categoryId && categoryId !== NEW_CATEGORY ? categoryId : null;
    if (categoryId === NEW_CATEGORY) {
      if (!newCategory.trim()) {
        setLoading(false);
        return setError("Enter the new category name or pick an existing one.");
      }
      const { data, error: catErr } = await supabase
        .from("categories")
        .insert({ business_id: businessId, name: newCategory.trim() })
        .select("id")
        .single();
      if (catErr || !data) {
        setLoading(false);
        return setError(
          catErr?.code === "23505" ? "That category already exists. Pick it from the list." : catErr?.message ?? "Could not create category."
        );
      }
      category = data.id;
    }

    const { error: updErr } = await supabase
      .from("products")
      .update({
        name: name.trim(),
        barcode: barcode.trim() || null,
        category_id: category,
        unit,
        selling_price: price === "" ? 0 : priceNum,
        reorder_level: reorderNum,
        is_active: isActive,
      })
      .eq("id", product.id);

    setLoading(false);
    if (updErr) {
      return setError(
        updErr.code === "23505" ? "Another product already uses that barcode or code." : updErr.message
      );
    }
    setSaved(true);
    setCategoryId(category ?? "");
    setNewCategory("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert err" role="alert">{error}</div>}
      {saved && <div className="alert">Saved.</div>}

      <div className="field">
        <label htmlFor="pname">Product name</label>
        <input id="pname" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="barcode">Barcode <span className="hint">(optional)</span></label>
          <input id="barcode" className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="unit">Unit</label>
          <select id="unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {(UNITS.includes(unit) ? UNITS : [unit, ...UNITS]).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="category">Category</label>
        <select id="category" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value={NEW_CATEGORY}>+ Add new category...</option>
        </select>
        {categoryId === NEW_CATEGORY && (
          <input className="input" style={{ marginTop: 8 }} placeholder="New category name"
            value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="price">Selling price</label>
          <NumberInput id="price" className="input" min={0} step="0.01" value={price}
            onChange={(e) => setPrice(e.target.value)} />
          {latestCost !== null && (
            <span className="hint">
              Latest cost: {formatMoney(latestCost, currency)}. Markup:{" "}
              {[20, 30, 50].map((m) => (
                <button key={m} type="button" className="link-btn" style={{ marginRight: 8 }}
                  onClick={() => setPrice((Math.round(latestCost * (1 + m / 100) * 100) / 100).toString())}>
                  +{m}%
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="reorder">Reorder level</label>
          <NumberInput integer id="reorder" className="input" min={0} value={reorder}
            onChange={(e) => setReorder(e.target.value)} />
          <span className="hint">Alert when stock falls to this number.</span>
        </div>
      </div>

      {belowCost && (
        <div className="alert warn">Selling price is below your latest cost, so each sale would lose money.</div>
      )}

      <label className="check">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active (available for sale in the POS)
      </label>

      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
