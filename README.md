# ServeBiz: POS and Inventory

Next.js + Supabase. See `PLAN.md` for the full roadmap.

## Run it
1. Create a free project at supabase.com.
2. SQL Editor -> run these in order: `supabase/schema.sql`, then `supabase/migrations/002_inventory.sql`, `003_pos.sql`, `004_stripe.sql`, `005_reports_tax.sql`, `006_roles.sql`, `007_demo.sql`. Each is safe to run again.
3. Authentication -> Sign In / Providers -> turn on **Allow anonymous sign-ins** (guest login). Leave CAPTCHA protection off until you set up the CAPTCHA key below (otherwise Supabase rejects every login).
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

### Paying online with GCash
The POS has two payment choices: **Cash** and **Online (Stripe)**. The Stripe page chooses its payment methods automatically, so GCash appears once it is switched on in your Stripe account: Dashboard -> Settings -> Payment methods -> turn on **GCash**. It needs your business currency set to PHP in ServeBiz Settings, and Stripe only offers GCash to Philippines-based accounts. Until then the page shows card only. In test mode, GCash opens a Stripe test page where you choose to authorize or fail the payment. The receipt records which method the customer used.

## Tax
Settings -> **Tax**: set a name (VAT, Sales tax), a rate, and whether your prices already include tax. The POS applies it to every sale and the receipt shows it. The POS cart also has an **Add tax** shortcut that opens this setting.

## Dashboard and reports
The dashboard shows **Total income** (net sales, before tax, completed sales only) and a daily sales chart for 7, 30, or 90 days in your own timezone. **Reports** adds profit and top products.

## Staff roles
Settings are for the owner; day-to-day work is split by role.

| | Owner | Manager | Cashier |
|---|---|---|---|
| Ring up sales, reprint own receipts | yes | yes | yes |
| See everyone's sales, void a sale | yes | yes | no |
| Receive stock, edit products/prices, suppliers | yes | yes | no |
| See costs, reports, profit | yes | yes | no |
| Business details, tax, currency | yes | no | no |
| Invite and remove staff | yes | no | no |

- **Team** page (owner): invite by email with a role, change roles, remove people, cancel invites. Nothing is emailed from the app, so tell the person to sign up or log in with that exact email; they join automatically. The email must be confirmed, so keep **Confirm email** ON in production.
- Cashiers land on the POS and only see their own sales. They never see costs or profit.
- The limits are enforced in the database (Row Level Security and checked functions in `006_roles.sql`), so they hold even if someone skips the app and calls the API directly.
- One business per login for now. If someone already created their own business, an invite to another one will not move them; have them use a different email.
- Without migration 006 the app still works and everyone behaves as an owner.

## Guest demo store
"Continue as guest" gives each visitor a private, populated shop (`007_demo.sql`): 17 products, 3 suppliers, stock batches with one near expiry and one expired, a month of sales (cash and online), two voided sales, a product that still needs pricing, and low-stock alerts. A banner offers **Reset demo**. Without migration 007, guests get the normal empty-business setup instead.

Clean up old guests so they do not pile up (they are real accounts in Supabase):
- run `select public.purge_old_demos(24);` in the SQL Editor now and then, or
- schedule that same statement in Supabase (Integrations -> Cron).

Before sharing the site publicly, turn on CAPTCHA (next section), otherwise bots can create guest accounts freely.

## CAPTCHA (do this before going public)
Guest logins create real accounts, so protect them from bots with Cloudflare Turnstile (free).
1. Cloudflare dashboard -> Turnstile -> **Add widget**. Add your site's domain (and `localhost` for testing). Copy the **Site key** and **Secret key**.
2. Supabase -> Authentication -> Attack Protection -> **Enable CAPTCHA protection** -> provider **Cloudflare Turnstile** -> paste the **Secret key** -> Save.
3. Put the site key in `.env.local` as `NEXT_PUBLIC_TURNSTILE_SITE_KEY=...` (and in Vercel Environment Variables), then restart `npm run dev` / redeploy.

The login page then shows the check and passes it to Supabase for log in, sign up, and guest login. Do steps 2 and 3 together: a key without Supabase's switch does nothing, and Supabase's switch without a key blocks all logins (the page tells you so). For a quick local test, Cloudflare's test keys always pass: site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## Exporting data
Products page: **Export products** (prices, cost, stock) and **Export stock batches** (owner/manager). Sales history: **Export CSV** (up to 5,000 rows; a cashier only gets their own sales). Files open in Excel or Google Sheets. Text that looks like a formula is neutralised so a product named `=1+1` cannot run anything.

## Ideas for later
Multiple businesses per login, CSV import, purchase orders, refunds for partly returned sales. See `PLAN.md`.
