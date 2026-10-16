# ServeBiz: POS and Inventory

Next.js + Supabase. See `PLAN.md` for the full roadmap.

## Run it
1. Create a free project at supabase.com.
2. SQL Editor -> run `supabase/schema.sql`, then `supabase/migrations/002_inventory.sql` (both are safe to run in order).
3. Authentication -> Sign In / Providers -> turn on **Allow anonymous sign-ins** (guest login). Turn off CAPTCHA protection until the app sends a CAPTCHA token.
4. For quick testing, turn off "Confirm email" under the Email provider.
5. Copy `.env.example` to `.env.local` and fill in the project URL and anon key (Project Settings -> API).
6. `npm install` then `npm run dev`, open http://localhost:3000. Restart the dev server after editing `.env.local`.

## Flow
Landing -> Login / Guest -> (no business yet) Onboarding -> Dashboard.

## Inventory (Phase 1)
- **Receiving**: record a delivery (code, name, supplier, dates, quantity, base price, batch). A new code creates the product automatically as "Needs pricing".
- **Products**: set selling price, category, unit, barcode, reorder level, active flag. Quantity is computed from batches.
- **Remove stock**: damaged / expired / other, earliest-expiring batch first or a chosen batch. Everything is logged in Stock history.
- **Suppliers**: reusable list.
- **Dashboard**: stock value, low stock, expiring or expired batches, products needing prices.

## Next
Phase 2: point of sale (cart, checkout, receipts), then Stripe test payments. See `PLAN.md`.
