"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import type { Category } from "@/lib/types";
import NumberInput from "@/components/NumberInput";
import QtyInput from "./QtyInput";

export type PosProduct = {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  unit: string;
  price: number;
  stock: number;
};

type Props = {
  business: { id: string; name: string; location: string | null; contact_phone: string | null };
  currency: string;
  taxRate: number;
  taxName: string;
  taxInclusive: boolean;
  products: PosProduct[];
  categories: Category[];
  stripeEnabled: boolean;
  notice: string | null;
  restoreCart: boolean;
  /** only the owner can open Settings to change tax */
  canEditTax: boolean;
};

// Two ways to pay: cash at the counter, or online through Stripe (card, GCash, and whatever else
// is enabled in the Stripe dashboard).
type Method = "cash" | "stripe";

const CART_KEY = "servebiz-cart";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PosClient({ business, currency, taxRate, taxName, taxInclusive, products, categories, stripeEnabled, notice, restoreCart, canEditTax }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(notice);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const money = (n: number) => formatMoney(n, currency);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Coming back from a cancelled or failed Stripe payment: put the cart back.
  useEffect(() => {
    if (!restoreCart) return;
    try {
      const saved = sessionStorage.getItem(CART_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, number>;
      const restored: Record<string, number> = {};
      for (const [id, qty] of Object.entries(parsed)) {
        const p = byId.get(id);
        if (p && Number.isInteger(qty) && qty > 0 && p.stock > 0) restored[id] = Math.min(qty, p.stock);
      }
      setCart(restored);
      if (!notice) setError("Online payment cancelled. Your cart is still here.");
    } catch {
      // Storage unavailable: start with an empty cart.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId !== "all" && p.categoryId !== categoryId) return false;
      if (!needle) return true;
      return `${p.name} ${p.code} ${p.barcode ?? ""}`.toLowerCase().includes(needle);
    });
  }, [products, query, categoryId]);

  const TILES_PER_PAGE = 24;
  const [tilePage, setTilePage] = useState(1);
  useEffect(() => setTilePage(1), [query, categoryId]);
  const tilePages = Math.max(1, Math.ceil(filtered.length / TILES_PER_PAGE));
  const safeTilePage = Math.min(tilePage, tilePages);
  const visible = filtered.slice((safeTilePage - 1) * TILES_PER_PAGE, safeTilePage * TILES_PER_PAGE);

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ product: byId.get(id)!, qty }))
    .filter((l) => l.product);

  const subtotal = round2(lines.reduce((s, l) => s + l.product.price * l.qty, 0));
  const discNum = Number(discountValue) || 0;
  const discount = Math.min(
    subtotal,
    round2(discountType === "percent" ? (subtotal * Math.min(discNum, 100)) / 100 : discNum)
  );
  // Mirrors quote_sale() in the database, which is the authority at checkout.
  const base = subtotal - discount;
  const tax = round2(taxInclusive ? (base * taxRate) / (100 + taxRate) : (base * taxRate) / 100);
  const total = round2(taxInclusive ? base : base + tax);

  const tenderedNum = tendered === "" ? total : Number(tendered);
  const change = round2(tenderedNum - total);
  const cashShort = method === "cash" && change < 0;

  const quickAmounts = useMemo(() => {
    if (total <= 0) return [];
    const steps = [50, 100, 500, 1000];
    const set = new Set<number>([total, ...steps.map((s) => Math.ceil(total / s) * s)]);
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  function add(p: PosProduct) {
    setError(null);
    setCart((c) => {
      const current = c[p.id] ?? 0;
      if (current >= p.stock) return c;
      return { ...c, [p.id]: current + 1 };
    });
  }

  function setQty(id: string, qty: number) {
    const p = byId.get(id);
    if (!p) return;
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(qty, p.stock);
      return next;
    });
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    // Barcode scanners type the code then press Enter: prefer an exact barcode/code match.
    const exact = products.find(
      (p) => p.barcode?.toLowerCase() === needle || p.code.toLowerCase() === needle
    );
    const target = exact ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (target) {
      if (target.stock > 0) add(target);
      else setError(`${target.name} is out of stock.`);
      setQuery("");
    } else {
      setError("No single matching product. Refine the search or tap a product.");
    }
  }

  function clearCart() {
    setCart({});
    setDiscountValue("");
    setTendered("");
    setError(null);
  }

  async function stripeCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
          discountType,
          discountValue: discNum,
        }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "Could not start the online payment.");
        setLoading(false);
        return;
      }
      try {
        sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
      } catch {
        // Not critical: the cart just will not be restored if the payment is cancelled.
      }
      window.location.href = json.url;
    } catch {
      setError("Network error. Check your connection and try again.");
      setLoading(false);
    }
  }

  async function checkout() {
    setError(null);
    if (lines.length === 0) return setError("The cart is empty.");
    if (cashShort) return setError("Cash received is less than the total.");
    if (method === "stripe") return stripeCheckout();

    setLoading(true);
    const { data: saleId, error: rpcErr } = await supabase.rpc("complete_sale", {
      p_business_id: business.id,
      p_items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
      p_discount_type: discountType,
      p_discount_value: discNum,
      p_method: method,
      p_tendered: tenderedNum,
      p_reference: null,
    });

    if (rpcErr || !saleId) {
      setLoading(false);
      return setError(
        rpcErr?.message.includes("complete_sale")
          ? "The POS functions are missing. Run supabase/migrations/003_pos.sql in Supabase first."
          : rpcErr?.message ?? "Checkout failed."
      );
    }

    const [{ data: sale }, { data: items }] = await Promise.all([
      supabase.from("sales").select("receipt_no,created_at,status,subtotal,discount,tax,total").eq("id", saleId).single(),
      supabase.from("sale_items").select("quantity,unit_price,products(name)").eq("sale_id", saleId),
    ]);
    setLoading(false);

    if (sale) {
      setReceipt({
        ...(sale as Omit<ReceiptData, "items" | "method" | "tendered">),
        method,
        tendered: tenderedNum,
        items: ((items ?? []) as unknown as { quantity: number; unit_price: number; products: { name: string } | null }[]).map(
          (i) => ({ name: i.products?.name ?? "Item", quantity: i.quantity, unit_price: i.unit_price })
        ),
      });
    }
    clearCart();
    router.refresh();
  }

  function newSale() {
    setReceipt(null);
    searchRef.current?.focus();
  }

  return (
    <div className="pos">
      <div>
        <div className="pos-search">
          <input
            ref={searchRef}
            className="input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search products or scan a barcode, then press Enter"
            aria-label="Search products or scan barcode"
          />
        </div>

        {categories.length > 0 && (
          <div className="cat-row">
            <button type="button" className={`tab${categoryId === "all" ? " active" : ""}`} onClick={() => setCategoryId("all")}>All</button>
            {categories.map((c) => (
              <button key={c.id} type="button" className={`tab${categoryId === c.id ? " active" : ""}`} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {products.length === 0 ? (
          <div className="card empty">
            No products are ready to sell yet. Receive stock, then open each product to set a selling price and mark it active.
          </div>
        ) : filtered.length === 0 ? (
          <div className="card empty">No products match.</div>
        ) : (
          <div className="tiles">
            {visible.map((p) => {
              const inCart = cart[p.id] ?? 0;
              const out = p.stock <= 0;
              return (
                <button key={p.id} type="button" className="tile" disabled={out || inCart >= p.stock} onClick={() => add(p)}>
                  <span className="t-name">{p.name}</span>
                  <span className="t-stock">{out ? "Out of stock" : `${p.stock - inCart} ${p.unit} left`}</span>
                  <span className="t-price">{money(p.price)}</span>
                </button>
              );
            })}
          </div>
        )}
        {tilePages > 1 && (
          <div className="pager" style={{ justifyContent: "center" }}>
            <button className="btn" type="button" disabled={safeTilePage <= 1} onClick={() => setTilePage(safeTilePage - 1)}>Previous</button>
            <span className="muted pager-info">Page {safeTilePage} of {tilePages} · {filtered.length} products</span>
            <button className="btn" type="button" disabled={safeTilePage >= tilePages} onClick={() => setTilePage(safeTilePage + 1)}>Next</button>
          </div>
        )}
      </div>

      <aside className="cart" aria-label="Cart">
        <h3>Current sale</h3>

        {lines.length === 0 ? (
          <div className="cart-empty">Tap a product to add it.</div>
        ) : (
          lines.map(({ product: p, qty }) => (
            <div className="cart-line" key={p.id}>
              <div>
                <div className="name">{p.name}</div>
                <div className="each">{money(p.price)} each</div>
              </div>
              <div className="amt">{money(p.price * qty)}</div>
              <div className="qty">
                <button type="button" aria-label={`Decrease ${p.name}`} onClick={() => setQty(p.id, qty - 1)}>&minus;</button>
                <QtyInput value={qty} max={p.stock} label={p.name} onChange={(n) => setQty(p.id, n)} />
                <button type="button" aria-label={`Increase ${p.name}`} disabled={qty >= p.stock} onClick={() => setQty(p.id, qty + 1)}>+</button>
                <button type="button" className="remove" onClick={() => setQty(p.id, 0)}>Remove</button>
              </div>
            </div>
          ))
        )}

        {lines.length > 0 && (
          <>
            <div className="disc-row" style={{ marginTop: 12 }}>
              <select className="input" value={discountType} onChange={(e) => setDiscountType(e.target.value as "amount" | "percent")} aria-label="Discount type">
                <option value="amount">Discount {currency}</option>
                <option value="percent">Discount %</option>
              </select>
              <NumberInput className="input" min={0} step="0.01" value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)} placeholder="0" aria-label="Discount value" />
            </div>

            <div className="totals">
              <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {discount > 0 && <div><span>Discount</span><span>-{money(discount)}</span></div>}
              {taxRate > 0 ? (
                <div>
                  <span>
                    {taxName} ({taxRate}%{taxInclusive ? ", included" : ""}){" "}
                    {canEditTax && <Link href="/settings#tax" className="link-btn" style={{ fontSize: 12 }}>change</Link>}
                  </span>
                  <span>{money(tax)}</span>
                </div>
              ) : (
                <div>
                  <span className="muted">No tax set</span>
                  {canEditTax ? (
                    <Link href="/settings#tax" className="link-btn" style={{ fontSize: 13 }}>Add tax</Link>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>Ask the owner</span>
                  )}
                </div>
              )}
              <div className="grand"><span>Total</span><span>{money(total)}</span></div>
            </div>

            <div className="pay-methods two" role="group" aria-label="Payment method">
              <button type="button" className={method === "cash" ? "on" : ""} onClick={() => setMethod("cash")}>Cash</button>
              <button
                type="button"
                className={method === "stripe" ? "on" : ""}
                disabled={!stripeEnabled}
                title={stripeEnabled ? undefined : "Add a Stripe test key to enable online payments"}
                onClick={() => setMethod("stripe")}
              >
                Online (Stripe)
              </button>
            </div>
            {!stripeEnabled && (
              <div className="hint" style={{ marginTop: -4, marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
                Online payments are off. Add <code>STRIPE_SECRET_KEY</code> to enable them (see README).
              </div>
            )}

            {method === "cash" ? (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label htmlFor="tendered">Cash received</label>
                  <NumberInput id="tendered" className="input" min={0} step="0.01" value={tendered}
                    onChange={(e) => setTendered(e.target.value)} placeholder={String(total)} />
                </div>
                <div className="quick">
                  {quickAmounts.map((a) => (
                    <button key={a} type="button" onClick={() => setTendered(String(a))}>{a === total ? "Exact" : money(a)}</button>
                  ))}
                </div>
                <div className={`change${cashShort ? " short" : ""}`}>
                  <span>{cashShort ? "Still needed" : "Change"}</span>
                  <span>{money(Math.abs(change))}</span>
                </div>
              </>
            ) : (
              <div className="alert" style={{ fontSize: 13 }}>
                The customer pays on Stripe&apos;s secure test page (card, GCash, or any other method enabled in your Stripe dashboard). Test card: <strong>4242 4242 4242 4242</strong>, any future expiry, any CVC.
              </div>
            )}
          </>
        )}

        {error && <div className="alert err" role="alert">{error}</div>}

        <button className="btn btn-primary btn-block" type="button" disabled={loading || lines.length === 0 || cashShort} onClick={checkout}>
          {loading
            ? method === "stripe" ? "Opening Stripe..." : "Processing..."
            : lines.length
              ? method === "stripe" ? `Pay ${money(total)} online` : `Charge ${money(total)}`
              : "Charge"}
        </button>
        {lines.length > 0 && (
          <button className="btn btn-block" type="button" style={{ marginTop: 8 }} onClick={clearCart} disabled={loading}>
            Clear cart
          </button>
        )}
      </aside>

      {receipt && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Receipt">
          <div className="modal">
            <div className="alert">Sale complete.</div>
            <Receipt business={business} currency={currency} data={receipt} taxLabel={taxRate > 0 ? `${taxName} (${taxRate}%${taxInclusive ? ", included" : ""})` : taxName} />
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => window.print()}>Print</button>
              <button className="btn btn-primary" type="button" onClick={newSale}>New sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
