import Stripe from "stripe";

// Currencies Stripe counts in whole units (no cents).
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

const TEST_KEY = /^(sk|rk)_test_/;

/** True only when a Stripe TEST key is configured. Live keys are deliberately refused. */
export function isStripeEnabled(): boolean {
  return TEST_KEY.test(process.env.STRIPE_SECRET_KEY ?? "");
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return TEST_KEY.test(key) ? new Stripe(key) : null;
}

export const CART_META_PREFIX = "cart_";

/** Stripe metadata values are limited to 500 characters, so the cart is split across keys. */
export function cartToMetadata(items: { product_id: string; quantity: number }[]): Record<string, string> {
  const chunks: string[] = [];
  let current = "";
  for (const it of items) {
    const part = `${it.product_id}:${it.quantity};`;
    if (current.length + part.length > 480) {
      chunks.push(current);
      current = "";
    }
    current += part;
  }
  if (current) chunks.push(current);
  const out: Record<string, string> = {};
  chunks.forEach((c, i) => (out[`${CART_META_PREFIX}${i}`] = c));
  return out;
}

export function cartFromMetadata(meta: Record<string, string> | null | undefined): { product_id: string; quantity: number }[] {
  if (!meta) return [];
  const keys = Object.keys(meta)
    .filter((k) => k.startsWith(CART_META_PREFIX))
    .sort((a, b) => Number(a.slice(CART_META_PREFIX.length)) - Number(b.slice(CART_META_PREFIX.length)));
  const items: { product_id: string; quantity: number }[] = [];
  for (const k of keys) {
    for (const part of meta[k].split(";")) {
      if (!part) continue;
      const [product_id, qty] = part.split(":");
      const quantity = Number(qty);
      if (product_id && Number.isInteger(quantity) && quantity > 0) items.push({ product_id, quantity });
    }
  }
  return items;
}
