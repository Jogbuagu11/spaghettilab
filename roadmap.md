# Spaghetti Lab roadmap

## Phase 1 — public site (done)
- [x] Design system, home, /menu, /order with plate builder, cart, scheduling, live totals
- [x] Pricing + time-slot rules with tests, per-page SEO + LocalBusiness/Menu JSON-LD

## Phase 2 — backend (done)
- [x] Orders table, server-side price/fee/tax validation
- [x] Delivery address check within 5 miles of 95131 (geocoding)
- [x] Admin dashboard: orders, status buttons, prices, sold out, hours, tax rate, social/analytics/review links
- [x] /track order page

## Phase 3 — integrations (done, pending credentials)
- [x] Square payments — card, Apple Pay, Google Pay via Web Payments SDK
- [x] Confirmation / status / cancellation / review-request emails, branded, via Resend
- [x] /reviews with verified reviews + AggregateRating schema, moderated in /admin
- [x] GA4 + Meta Pixel wiring (ids set in /admin), sitemap, manifest, social share cards

## Phase 4 — scheduled & recurring (done)
- [x] Free delivery now requires $60+ **and** a day's notice, to push orders out of the rush
- [x] Weekly standing orders: card on file, auto-charged, free delivery, skip/pause/cancel
- [x] Admin tab for standing orders; customer self-service at /subscription

## Phase 5 — proof of delivery (done)
- [x] Camera capture on "Delivered", optional, with a drop-off note
- [x] Delivery-specific email with the photo embedded; photo also on /track
- [x] 30-day automatic purge, admin-only uploads, path pinned to the order

## Phase 6 — receipts (done)
- [x] Itemised Square orders so receipts and item sales reporting work
- [x] Tax rounding aligned with Square's half-to-even
- [x] 80mm thermal kitchen ticket from /admin

## Still needs the owner
- [x] Supabase project linked, migrations applied, admin user seeded
- [x] spaghettilab.store verified in Resend
- [x] Square sandbox webhook created, catalog seeded
- [x] Pickup address set (1183 Benny Ct)
- [x] All 9 edge functions deployed, secrets set
- [x] Cron jobs scheduled (run-subscriptions daily, send-review-requests hourly)
- [x] Vercel env vars set; main pushed and deployed
- [x] Apex is now the serving domain; www 308-redirects to it
- [x] Apple Pay domain VERIFIED in both Square sandbox and production
- [ ] Phone number and social URLs (enter in /admin -> Settings)
- [ ] Square is still in **sandbox** — flip when you're ready to take real money
- [ ] Rotate the credentials that were shared in plaintext
- [ ] Switch Square from sandbox to production once test orders look right

## Later
- [ ] SMS order updates (Twilio) — email only today
- [ ] Delivery photo is admin-captured; no separate driver app or login
- [ ] Printed kitchen tickets / receipt printer
- [ ] Loyalty or repeat-order discounts
