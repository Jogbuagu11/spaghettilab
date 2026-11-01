# Spaghetti Lab

Order-ahead storefront for a permitted MEHKO home kitchen in Berryessa, North San Jose.
Customers build a spaghetti plate, pick pickup or delivery, choose a time, and pay by card,
Apple Pay or Google Pay.

- **Frontend** — TanStack Start (React 19, Vite, Tailwind v4), deployed to Vercel at `spaghettilab.store`
- **Database & API** — Supabase Postgres + Edge Functions (Deno)
- **Payments** — Square Web Payments SDK + Payments API
- **Email** — Resend, from `no-reply@spaghettilab.store`

This project was built with [Lovable](https://lovable.dev) and syncs with the
[Lovable editor](https://lovable.dev/projects/fef5898b-32d2-4b23-bc51-5fea3a3f81ae).

---

## How it fits together

```
Browser                      Supabase Edge Functions            External
───────                      ───────────────────────            ────────
build plate  ─ read menu ──▶ (direct PostgREST read, RLS)
                 │
checkout ───────┼─ card ───▶ Square Web Payments SDK ─────────▶ token
                 │
                 └─ order ─▶ create-order
                               ├─ re-prices the cart from the DB
                               ├─ validates the time slot
                               ├─ checks the delivery radius ──▶ geocoder
                               ├─ charges the token ───────────▶ Square
                               ├─ writes orders + order_items
                               └─ emails receipt + ticket ────▶ Resend

/track?token=… ───────────▶ track-order        (token-scoped, no login)
/review?token=… ──────────▶ submit-review      (proves they ordered)
/admin ───────────────────▶ update-order-status (admin JWT, refunds + emails)
Square ───────────────────▶ square-webhook     (HMAC-verified)
cron ─────────────────────▶ send-review-requests
```

**The browser never sends prices.** It says *what* it wants; `create-order` re-prices the whole
cart from `menu_options` and `settings` before charging. A tampered payload cannot set its own
total. This is covered by `supabase/functions/_shared/catalog_test.ts`.

---

## Local development

```sh
bun install
cp .env.example .env.local      # fill in the values below
bun run dev
```

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on :8080 |
| `bun run build` | Production build |
| `bun run test` | Frontend unit tests (vitest) |
| `deno test --allow-env supabase/functions/_shared/` | Edge function tests |
| `bun run lint` | ESLint + Prettier |

The storefront falls back to the build-time menu in `src/lib/menu.ts` when Supabase isn't
configured, so the site still renders without credentials — checkout is simply disabled.

---

## Setup

### 1. Supabase

```sh
supabase link --project-ref YOUR-PROJECT-REF
supabase db push                       # applies the three migrations
```

Grant yourself admin access (this is what unlocks `/admin`):

```sql
insert into admin_users (email) values ('you@example.com');
```

Set the function secrets, then deploy:

```sh
supabase secrets set --env-file .env.local
supabase functions deploy create-order track-order submit-review \
                          update-order-status send-review-requests
# Square calls this one without a Supabase JWT, so it must skip auth:
supabase functions deploy square-webhook --no-verify-jwt
```

> `create-order`, `track-order` and `submit-review` are called by anonymous visitors using the
> anon key, so leave JWT verification on for them — they authorise by their own rules
> (track tokens, re-pricing) rather than by session.

### 2. Square

Square **retired its CLI** — the `square-cli` npm package was unpublished on 2026‑01‑12 and the
docs page now 404s. This repo ships a replacement that calls the Catalog API directly:

```sh
node scripts/square-catalog-seed.mjs --dry-run   # inspect the payload
node scripts/square-catalog-seed.mjs             # create/update the catalog
```

It builds one **Spaghetti Plate** item with Small/Medium/Large variations plus Heat, Proteins
and Add-ons modifier lists, and one item per side/drink — so Square receipts and sales reports
break down properly instead of showing a single opaque total. Re-running updates in place:
Square object ids are written back to `menu_options`.

Then in the Square dashboard:

1. **Webhook** — add a subscription pointing at
   `https://YOUR-PROJECT-REF.supabase.co/functions/v1/square-webhook`, subscribed to
   `payment.updated`, `refund.created` and `refund.updated`. Copy the signature key into
   `SQUARE_WEBHOOK_SIGNATURE_KEY`. The URL must byte-match `SQUARE_WEBHOOK_URL`.
2. **Apple Pay** — register `spaghettilab.store` under *Developer → Apple Pay*. Until the domain
   is verified the Apple Pay button simply won't render; card payments are unaffected.

Go live by swapping `SQUARE_ENVIRONMENT` / `VITE_SQUARE_ENVIRONMENT` to `production` and
replacing the token, application id and location id with production values.

### 3. Resend

Verify `spaghettilab.store` in Resend and add the DNS records it gives you (SPF, DKIM, and a
DMARC record). Without DKIM, Gmail and Outlook will send order receipts to spam.

All five templates share one branded shell (`supabase/functions/_shared/emails/layout.ts`) using
the site's palette and logo, and every send is recorded in `email_log` — which doubles as the
idempotency guard, so a retried webhook can't send a second receipt.

| Template | Trigger |
| --- | --- |
| `order_confirmation` | Payment succeeds |
| `kitchen_alert` | Payment succeeds (to `KITCHEN_EMAIL`) |
| `order_preparing` / `order_ready` / `order_out_for_delivery` / `order_completed` | Admin status change |
| `order_cancelled` | Admin cancels, with refund status |
| `review_request` | 3 hours after completion (cron) |

Optional — schedule the review sweep by following `supabase/cron-review-requests.sql`.

### 4. Vercel

Point the project at this repo. `vercel.json` pins `NITRO_PRESET=vercel`, so the build emits
Build Output API v3 to `.vercel/output`. Set these in *Project Settings → Environment Variables*:

```
VITE_SITE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
VITE_SQUARE_APP_ID, VITE_SQUARE_LOCATION_ID, VITE_SQUARE_ENVIRONMENT
```

Add `spaghettilab.store` as the production domain.

---

## Admin dashboard

`/admin`, protected by a Supabase magic link and the `admin_users` allowlist (enforced in RLS,
not just the UI).

- **Orders** — live tickets, auto-refreshing; status buttons that email the customer, and cancel
  with an automatic Square refund
- **Menu** — edit any price, flag anything sold out; changes are live immediately and are
  re-validated at checkout
- **Hours** — per-day opening times (America/Los_Angeles)
- **Settings** — tax rate, delivery fee and radius, prep time, pickup address, contact details,
  social links, GA4 / Meta Pixel ids, and a kill switch for new orders
- **Reviews** — moderate before anything appears publicly

## Privacy notes

- The **pickup address is never public**. `anon` has column-level `SELECT` on `settings` that
  excludes it; it's disclosed in the confirmation email and on `/track` only after payment.
- Orders have **no anonymous RLS policy at all** — an unauthenticated read returns nothing.
  Customers reach their own order through a 128-bit `track_token`.
- No analytics load unless the owner sets a GA4 or Pixel id in the dashboard.

## Brand assets

Every icon and share image is generated from one source file:

```sh
npx --yes --package=sharp -c "node scripts/generate-brand-assets.mjs"
```

Replace `brand/logo-source.png` and re-run to refresh the favicon, PWA icons, Apple touch icon
and both social cards. The script flood-fills the source's white background to transparency so
the mark works on any surface.
