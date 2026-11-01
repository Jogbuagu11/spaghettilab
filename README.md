# Spaghetti Lab

Order-ahead storefront for a permitted MEHKO home kitchen in Berryessa, North San Jose.
Customers build a spaghetti plate, order it once or every week, and pay by card, Apple Pay
or Google Pay.

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

weekly signup ────────────▶ create-subscription (vaults a card with Square)
cron (daily 9am) ─────────▶ run-subscriptions   (re-prices, charges, emails)

/track?token=… ───────────▶ track-order        (token-scoped, no login)
/subscription?token=… ────▶ manage-subscription (skip, pause, cancel)
/review?token=… ──────────▶ submit-review      (proves they ordered)
/admin ───────────────────▶ update-order-status (admin JWT, refunds + emails)
Square ───────────────────▶ square-webhook     (HMAC-verified)
cron ─────────────────────▶ send-review-requests
```

**The browser never sends prices.** It says *what* it wants; the server re-prices the whole
cart from `menu_options` and `settings` before charging. A tampered payload cannot set its own
total. Checkout and the weekly run share one `placeAndChargeOrder`, so there is exactly one
place where an order becomes real. Covered by `supabase/functions/_shared/catalog_test.ts`.

### Delivery pricing

Free delivery takes planning, not just a big basket:

| | ASAP / same day | Scheduled a day ahead |
| --- | --- | --- |
| **Under $60** | $7 | $7 |
| **$60 and over** | $7 | **Free** |
| **Weekly standing order** | **Free** | **Free** |

"a day ahead" means a later *calendar day* in the kitchen's timezone, so ordering at 7pm Monday
for noon Tuesday counts even though it's under 24 hours. Both knobs are admin-editable:
`free_delivery_min_lead_days = 0` restores the old size-only rule, and the weekly perk can be
switched off.

### Weekly standing orders

The customer saves a card once (Square Cards API — we store only the customer and card ids,
never card data), picks a weekday and time, and `run-subscriptions` creates and charges a real
order each week. Every run **re-prices against the live menu**, so a price change or a sold-out
topping is reflected automatically rather than frozen at signup. Three consecutive declines
pause the subscription instead of retrying forever. Skip, pause and cancel are one click from
any email; cancelling also disables the stored card.

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
supabase db push          # applies the migrations in supabase/migrations
```

`supabase db push --db-url "$SUPABASE_DB_URL"` also works and skips `supabase login`.

Admin access is granted by the `admin_users` allowlist, which RLS checks against the JWT email
claim. `20261101000600_owner_setup.sql` seeds `mrs.ogbuagu@gmail.com`; add others with:

```sql
insert into admin_users (email) values ('someone@example.com');
```

Set the function secrets, then deploy:

Cron-only functions (`run-subscriptions`, `send-review-requests`) authorise by reading the
`role` claim of the caller's JWT rather than string-matching the service role key — Supabase's
gateway has already verified the signature, and the injected key's format differs between the
legacy JWT and newer `sb_secret_` styles.

```sh
supabase secrets set --env-file .env.local
supabase functions deploy create-order track-order submit-review \
                          update-order-status send-review-requests \
                          create-subscription manage-subscription run-subscriptions
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

It reads Supabase through PostgREST when `SUPABASE_SERVICE_ROLE_KEY` is set, or straight from
Postgres via `SUPABASE_DB_URL` when `pg` is installed (`npm i -D pg`).

It builds one **Spaghetti Plate** item with Small/Medium/Large variations plus Heat, Proteins
and Add-ons modifier lists, and one item per side/drink — so Square receipts and sales reports
break down properly instead of showing a single opaque total. Re-running is safe: each run reads the live catalog and matches objects **by name**, so it
updates in place instead of duplicating — and it works against a catalog built by a previous
run, by hand, or not at all.

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
| `order_delivered` | A delivery is marked delivered — includes the drop-off photo |
| `review_request` | 3 hours after completion (cron) |
| `subscription_confirmed` | Weekly standing order created |
| `subscription_failed_*` | A weekly charge is declined |
| `subscription_cancelled` | Standing order cancelled |

Schedule the weekly subscription run and the review sweep with `supabase/cron-jobs.sql`
(already applied to this project — `select jobname, schedule, active from cron.job` to check).
The subscription job is **required** for standing orders to charge.

### 4. Vercel

Point the project at this repo. `vercel.json` pins `NITRO_PRESET=vercel`, so the build emits
Build Output API v3 to `.vercel/output`. Set these in *Project Settings → Environment Variables*:

```
VITE_SITE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
VITE_SQUARE_APP_ID, VITE_SQUARE_LOCATION_ID, VITE_SQUARE_ENVIRONMENT
```

Add `spaghettilab.store` as the production domain.

> **Apex vs www.** Vercel currently serves `www.spaghettilab.store` and 308-redirects the apex
> to it. Canonical URLs, the sitemap and `SITE_URL` all use the apex, so either set the apex as
> the primary domain in Vercel (recommended — it's the name on the storefront) or point
> `VITE_SITE_URL` and `SITE_URL` at the `www` host. Leaving them mismatched means every
> canonical URL and share link takes an extra redirect.

### Apple Pay

`public/.well-known/apple-developer-merchantid-domain-association` is Square's domain
association file; Vite copies it into the build and Vercel's filesystem handler serves it
before the SSR fallback. **It must be live before registration will succeed**, so deploy
first, then register:

```sh
curl -X POST https://connect.squareup.com/v2/apple-pay/domains \
  -H "Authorization: Bearer $SQUARE_PROD_ACCESS_TOKEN" \
  -H "Square-Version: 2025-09-24" -H "Content-Type: application/json" \
  -d '{"domain_name": "spaghettilab.store"}'
```

Register whichever host actually serves the file without a redirect.

---

## Admin dashboard

`/admin`, protected by a Supabase magic link and the `admin_users` allowlist (enforced in RLS,
not just the UI).

- **Orders** — live tickets, auto-refreshing; status buttons that email the customer, and cancel
  with an automatic Square refund
- **Weekly** — every standing order, its schedule, card and failure history; skip, pause or
  cancel on the customer's behalf (routed through the same function they use, so a cancellation
  still removes the card and sends the same email)
- **Menu** — edit any price, flag anything sold out; changes are live immediately and are
  re-validated at checkout
- **Hours** — per-day opening times (America/Los_Angeles)
- **Settings** — tax rate, delivery fee and radius, prep time, pickup address, contact details,
  social links, GA4 / Meta Pixel ids, and a kill switch for new orders
- **Reviews** — moderate before anything appears publicly

## Receipts and kitchen tickets

Checkout creates an **itemised Square order** (Orders API) and settles it, rather than posting a
bare amount to the Payments API. Receipts and Square's item-level reporting therefore show real
lines — `Spaghetti Plate / Large  $26.00` with `2x Meatball  $8.00` beneath it — instead of one
opaque total. Delivery rides as a non-taxable service charge and the tip is recorded as a tip.

Two details that are load-bearing:

- **Prices are sent explicitly, not by catalog id.** The admin can change a price in Supabase
  without re-running the catalog sync; if Square priced from a stale catalog the totals would
  diverge and the payment would be rejected.
- **Tax rounds half-to-even** (`roundCents`), because that is what Square does. `Math.round`
  rounds half *up* and disagrees on any half-cent — a plain Small plate is one ($12.00 x 9.375%
  = 112.5c) — and a payment whose amount doesn't match its order total is refused.

If Square's total ever disagrees with ours the code logs it and falls back to an unitemised
payment, so a pricing drift costs you itemisation, never the sale.

**Printing**: `/admin` → any order → **Print ticket**. Styled for an 80mm thermal roll
(`@page { size: 80mm auto }` in `src/styles.css`) and rendered off-screen, so it needs no popup,
no extra route and no second fetch. For a 58mm printer, change the two width values there.

## Proof of delivery

Marking a delivery **Delivered** in the admin opens the phone camera. The photo is optional —
skipping still completes the order and sends the same email, just without an image — because a
driver in the rain or handing the bag over in person shouldn't be blocked from closing a ticket.

The image is downscaled to 1600px and re-encoded client-side before upload (phone originals run
4–12MB, which is slow on a kitchen's connection and far more than an email needs), stored in the
public `delivery-proof` bucket, embedded in the delivered email and shown on the customer's
`/track` page.

The bucket is public because email clients can't send auth headers and a signed URL would expire
while the receipt is still in someone's inbox. Privacy comes from three things instead:

- an unguessable path (`{order uuid}/{random}.jpg`), validated server-side against the order so a
  photo can't be attached to someone else's receipt;
- an RLS policy allowing only admins to write to the bucket;
- a 30-day purge (`purge-delivery-photos`, daily via cron). Deletion is immediate at origin but a
  cached copy may survive at the CDN edge for up to its cache lifetime.

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
