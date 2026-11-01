<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- **Prices are never trusted from the browser.** The client sends selections only; the
  `create-order` edge function re-prices the whole cart from `menu_options` + `settings`
  (`supabase/functions/_shared/catalog.ts`) before charging Square. Never add a code path that
  reads a total, price or fee from the request body.
- **Source of truth for the menu is Supabase.** `src/lib/menu.ts` holds build-time defaults that
  the storefront uses as a fallback; `src/lib/storefront.ts` overlays the live rows. When you add
  a menu field, add it to the migration, `MenuData`, and the admin Menu tab.
- **Free delivery = $60+ AND a day's notice**, or any weekly standing order. The rule lives in
  `evaluateFreeDelivery()` — once in `supabase/functions/_shared/catalog.ts` (authoritative) and
  mirrored in `src/lib/pricing.ts` for display. Change both, or the quote won't match the charge.
- **Weekly orders re-price every run.** Never cache a subscription's total; `run-subscriptions`
  rebuilds it from the live menu so price changes and sold-out items are picked up.
- **Money is integer cents everywhere** — database, edge functions, and UI. Never floats.
- Time handling is America/Los_Angeles. Use the helpers in `src/lib/schedule.ts` (client) and
  `supabase/functions/_shared/schedule.ts` (server); both are DST-correct and tested.
- Orders are reachable only via a `track_token`, and the pickup address is withheld until an
  order is paid (column-level grant in `20261101000200_rls.sql`). Don't widen either.
- Secrets live in Supabase function secrets / Vercel env vars. Nothing secret goes in a
  migration, and only `VITE_*` values may reach the bundle.
- Tests: `bun run test` for the frontend, `deno test --allow-env supabase/functions/_shared/`
  for pricing and scheduling. Both must pass before shipping.
- Brand assets are generated from `brand/logo-source.png` by
  `scripts/generate-brand-assets.mjs` — edit the source, re-run, don't hand-edit the outputs.
