# ServeBiz: POS and Inventory

Next.js + Supabase. See `PLAN.md` for the full roadmap.

## Run it
1. Create a free project at supabase.com.
2. SQL Editor -> run these in order: `supabase/schema.sql`, then `supabase/migrations/002_inventory.sql`, `003_pos.sql`, `004_stripe.sql`.
3. Authentication -> Sign In / Providers -> turn on **Allow anonymous sign-ins** (guest login). Turn off CAPTCHA protection until the app sends a CAPTCHA token.
4. For quick testing, turn off "Confirm email" under the Email provider.
5. Copy `.env.example` to `.env.local` and fill in the project URL and anon key (Project Settings -> API).
6. `npm install` then `npm run dev`, open http://localhost:3000. Restart the dev server after editing `.env.local`.

## Flow
Landing -> Login / Guest -> (no business yet) Onboarding -> Dashboard.

## Inventory (Phase 1)
- **Receiving**: record a delivery. A new code creates the product as "Needs pricing".
- **Products**: selling price, category, unit, barcode, reorder level, active flag. Quantity comes from batches.
- **Remove stock**: damaged / expired / other, logged in Stock history.
- **Suppliers**, **Dashboard** (stock value, low stock, expiring batches).

## Point of sale (Phase 2)
- **POS**: search or scan a barcode (Enter), tap products, adjust quantities, discount (amount or %), pay by cash (with change), card, or e-wallet.
- Prices and totals are calculated on the server; stock comes off the earliest-expiring batch and expired batches are never sold.
- **Receipts**: printable (80 mm), reprint any time from **Sales history**.
- **Void**: puts the items back into their original batches.
- **Settings**: business details, currency, tax rate.

## Stripe test payments (Phase 3)
1. Create a free account at stripe.com and keep **Test mode** on.
2. Developers -> API keys -> copy the **Secret key** (`sk_test_...`).
3. Put it in `.env.local` as `STRIPE_SECRET_KEY=sk_test_...` and restart `npm run dev`. On Vercel, add it under Environment Variables.
4. In the POS, a **Stripe** payment button appears. Checkout opens Stripe's hosted test page: card `4242 4242 4242 4242`, any future expiry, any CVC. Other test cards: stripe.com/docs/testing.
5. After paying you land on the receipt. The sale is recorded only once Stripe confirms payment, and a payment can never create two sales.

Live keys (`sk_live_...`) are refused on purpose. Without a key, the Stripe button is simply hidden.

## Next
Reports, staff roles, guest demo data. See `PLAN.md`.
