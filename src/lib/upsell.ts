/**
 * What to suggest on the confirmation dialog.
 *
 * Two nudges, both only shown when the basket is actually missing the thing:
 * parmesan on the plates, and a drink in the order. Which menu rows count as
 * parmesan or a drink comes from `menu_options.kind`, so adding a new soda in
 * the admin is enough to make it offerable — no code change, no id list here.
 */

import type { MenuData, MenuItem } from "./menu";
import type { Plate } from "./pricing";

export interface CheeseUpsell {
  item: MenuItem;
  /** Plates that don't have it yet — never empty. */
  plateIds: string[];
  /** Cost of adding it to exactly those plates. */
  priceCents: number;
}

export interface Upsells {
  /** Null when every plate already has parmesan, or it's sold out. */
  cheese: CheeseUpsell | null;
  /** Empty once any drink is in the cart, or when none are available. */
  drinks: MenuItem[];
}

const byKind = (items: MenuItem[], kind: string) =>
  items.filter((i) => i.kind === kind && i.available);

export function findUpsells(
  plates: Plate[],
  extras: Record<string, number | undefined>,
  menu: MenuData,
): Upsells {
  // Only one cheese row is ever expected, but take the first available so a
  // sold-out parmesan isn't offered and a renamed one still works.
  const cheese = byKind(menu.customizations, "cheese")[0] ?? null;
  const without = cheese ? plates.filter((p) => !p.customs.includes(cheese.id as never)) : [];

  const drinks = byKind(menu.extras, "drink");
  const hasDrink = drinks.some((d) => (extras[d.id] ?? 0) > 0);

  return {
    cheese:
      cheese && without.length > 0
        ? {
            item: cheese,
            plateIds: without.map((p) => p.id),
            priceCents: cheese.price * without.length,
          }
        : null,
    drinks: hasDrink ? [] : drinks,
  };
}

export const hasUpsells = (u: Upsells): boolean => u.cheese !== null || u.drinks.length > 0;
