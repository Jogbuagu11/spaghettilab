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

## Still needs the owner
- [x] Supabase project linked, migrations applied, admin user seeded
- [x] spaghettilab.store verified in Resend
- [x] Square sandbox webhook created, catalog seeded
- [x] Pickup address set (1183 Benny Ct)
- [ ] Supabase service role key + access token, so the edge functions can be deployed
- [ ] Run `supabase/cron-jobs.sql` (weekly charges don't happen without it)
- [ ] Register spaghettilab.store for Apple Pay in the Square dashboard
- [ ] Phone number and social URLs (enter in /admin -> Settings)
- [ ] Rotate the credentials that were shared in plaintext
- [ ] Switch Square from sandbox to production once test orders look right

## Later
- [ ] SMS order updates (Twilio) — email only today
- [ ] Printed kitchen tickets / receipt printer
- [ ] Loyalty or repeat-order discounts
