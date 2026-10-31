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
- Menu prices, fees and hours live in `src/lib/menu.ts`; totals in `src/lib/pricing.ts`, time slots in `src/lib/schedule.ts` (America/Los_Angeles) — one source so UI and future server validation agree; covered by `src/test/rules.test.ts`.
- Cart state is client-side (`src/lib/cart.tsx`, localStorage) until orders move to the backend.
