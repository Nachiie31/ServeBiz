# ServeBiz: Roadmap

## Status
| Phase | State |
|---|---|
| 0. Landing, login, guest login, business setup | Done |
| 1. Inventory: receiving, batches, products, suppliers, stock removal | Done |
| 2. POS: cart, discounts, cash, receipts, sales history, void | Done |
| 3. Stripe test payments (card, GCash when enabled) | Done |
| 4. Reports and tax, dashboard sales chart | Done |
| 4. Staff roles (owner, manager, cashier) | Done |
| 4. Guest demo data | Done |
| CAPTCHA on login (Turnstile), CSV export | Done |
| Multi-business + branches, invite rule, password rules, pagination, typable POS qty | Done (migration 008) |
| All-branches overview, audit log | Done (migration 009) |
| CSV import (products and stock) | Done |
| Partial refunds | Done (migration 010) |
| Purchase orders | Done (migration 011) |
| Later: PWA/offline | Not started |

Stack: Next.js (App Router, TypeScript) + Supabase (Auth, Postgres, Storage) + Stripe (test mode). Deployed online (Vercel + Supabase).

## Phase 0: Foundation (this scaffold)
- Landing page
- Email login / sign up
- Guest login (Supabase anonymous sign-in, portfolio demo)
- Business onboarding: name, type, logo (optional), location, contact
- Route guards: not logged in -> /login; logged in without business -> /onboarding; otherwise -> /dashboard
- Database schema with Row Level Security (every row belongs to a business; users only see their own)

## Phase 1: Inventory (next)
Two-step flow, matching your idea:

1. **Receiving (stock-in)**: record a delivery
   - Fields: product name, product code/SKU, supplier, date received, expiry date, quantity received, base (cost) price, batch/lot no., notes
   - Each receipt creates a *batch* row (this is what makes expiry tracking and FIFO possible)
2. **Product catalog (for POS)**: product details used when selling
   - Fields: selling price, category, unit (pc/kg/box), barcode, reorder level, image, active/inactive
   - Total quantity = sum of remaining batch quantities (computed, never typed by hand, for accuracy)

Also in Phase 1:
- Suppliers list (reusable, not retyped)
- Categories
- Stock adjustments with a reason (damaged, expired, lost, recount). Every change is logged in a stock movement ledger
- Low-stock and near-expiry alerts on the dashboard
- Search, filter, sort, pagination, CSV import/export
- Barcode scan support (USB scanners type into a field, so it works with a normal input)

## Phase 2: POS (selling)
- Product search/scan -> cart -> checkout
- Cash / card (Stripe test) / e-wallet label payment methods, change computation
- Discounts, tax (VAT) settings per business
- Selling deducts stock from the earliest-expiring batch first (FEFO)
- Receipts (printable + PDF), sales history, void/refund with stock return
- Hold/resume a sale

## Phase 3: Stripe (test mode)
- Option A (recommended for portfolio): card payments at POS checkout via Stripe Checkout / Payment Element in test mode
- Option B: subscription plans for the app itself (Free / Pro) with Stripe test billing
- Webhooks to confirm payments before marking a sale paid

## Phase 4: Reports and business tools
- Dashboard: today's sales, top sellers, profit (selling price - base cost), inventory value
- Reports by date range, by product, by category; export CSV/PDF
- Staff accounts with roles (owner, manager, cashier) and permissions
- Audit log (who changed what)
- Multi-business switcher (one user, several businesses)

## Features you may have missed (suggested)
| Feature | Why it matters |
|---|---|
| Stock movement ledger | Single source of truth for "why is my count off?" |
| Batches + expiry (FEFO) | Needed for food/pharmacy; your expiry date field only works with batches |
| Suppliers + purchase orders | Natural next step after "received products" |
| Reorder level + low-stock alerts | Prevents stock-outs |
| Roles and permissions | Cashiers should not edit prices |
| Tax and discounts | Required for real receipts |
| Returns/refunds | POS is incomplete without it |
| Demo data seeder for guest login | Guests land on a populated, impressive demo; guest data resets automatically |
| Offline-friendly POS (PWA) | Stores lose internet; stretch goal |
| Settings page | Edit business info, logo, currency, tax rate |
| Currency/locale setting | Business could be in PHP, SGD, USD, etc. |

## Data model (see supabase/schema.sql)
businesses, business_members, suppliers, categories, products, stock_batches (received products), stock_movements (ledger), sales, sale_items, payments.

## Decisions made
- Currency default is PHP (changeable in Settings).
- Guest demo data is cleared after 24 hours (`purge_old_demos`), and a guest can reset it any time.
