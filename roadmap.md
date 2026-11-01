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

## Still needs the owner
- [ ] Supabase, Square and Resend credentials (see README "Setup")
- [ ] Verify spaghettilab.store in Resend (SPF + DKIM + DMARC DNS records)
- [ ] Register spaghettilab.store for Apple Pay in the Square dashboard
- [ ] Real pickup address, phone number and social URLs (enter in /admin -> Settings)
- [ ] Switch Square from sandbox to production once test orders look right

## Later
- [ ] SMS order updates (Twilio) — email only today
- [ ] Printed kitchen tickets / receipt printer
- [ ] Loyalty or repeat-order discounts
