import { describe, expect, it } from "vitest";
import { STATIC_MENU, type MenuData, type MenuItem } from "@/lib/menu";
import type { Plate } from "@/lib/pricing";
import { findUpsells, hasUpsells } from "@/lib/upsell";

const plate = (o: Partial<Plate> = {}): Plate => ({
  id: "p1",
  size: "small",
  heat: "mild",
  base: "minced-pork",
  proteins: {},
  customs: [],
  ...o,
});

/** Swaps one menu row for an edited copy, leaving the rest of the menu alone. */
const withItem = (group: keyof MenuData, id: string, patch: Partial<MenuItem>): MenuData => ({
  ...STATIC_MENU,
  [group]: (STATIC_MENU[group] as MenuItem[]).map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

/** Drops a property entirely — `{ kind: undefined }` isn't the same thing
 *  under exactOptionalPropertyTypes, and an untagged DB row has no key. */
const withoutKind = (group: keyof MenuData, id: string): MenuData => ({
  ...STATIC_MENU,
  [group]: (STATIC_MENU[group] as MenuItem[]).map((i) => {
    if (i.id !== id) return i;
    const { kind: _kind, ...rest } = i;
    return rest;
  }),
});

describe("checkout upsells", () => {
  it("offers parmesan and a drink to a bare plate", () => {
    const u = findUpsells([plate()], {}, STATIC_MENU);
    expect(u.cheese?.item.id).toBe("extra-cheese");
    expect(u.cheese?.priceCents).toBe(100);
    expect(u.drinks.map((d) => d.id)).toEqual(["water", "coke"]);
    expect(hasUpsells(u)).toBe(true);
  });

  it("suggests nothing once both are in the basket", () => {
    const u = findUpsells([plate({ customs: ["extra-cheese"] })], { coke: 1 }, STATIC_MENU);
    expect(u.cheese).toBeNull();
    expect(u.drinks).toEqual([]);
    expect(hasUpsells(u)).toBe(false);
  });

  it("prices parmesan only for the plates missing it", () => {
    const plates = [
      plate({ id: "a" }),
      plate({ id: "b", customs: ["extra-cheese"] }),
      plate({ id: "c" }),
    ];
    const u = findUpsells(plates, {}, STATIC_MENU);
    expect(u.cheese?.plateIds).toEqual(["a", "c"]);
    expect(u.cheese?.priceCents).toBe(200);
  });

  // Garlic bread is a side, not a drink: having one shouldn't silence the
  // drink nudge, and it should never be offered as one.
  it("doesn't count a side as a drink", () => {
    const u = findUpsells([plate()], { "garlic-bread": 2 }, STATIC_MENU);
    expect(u.drinks.map((d) => d.id)).toEqual(["water", "coke"]);
  });

  it("only needs one drink to stop asking", () => {
    expect(findUpsells([plate()], { water: 1 }, STATIC_MENU).drinks).toEqual([]);
  });

  it("ignores a drink the customer removed back down to zero", () => {
    expect(findUpsells([plate()], { coke: 0 }, STATIC_MENU).drinks).toHaveLength(2);
  });

  // The admin's sold-out switch has to reach the upsell too, or checkout
  // offers something the kitchen can't make.
  it("never suggests a sold-out item", () => {
    const noCheese = findUpsells(
      [plate()],
      {},
      withItem("customizations", "extra-cheese", {
        available: false,
      }),
    );
    expect(noCheese.cheese).toBeNull();

    const oneDrink = findUpsells([plate()], {}, withItem("extras", "water", { available: false }));
    expect(oneDrink.drinks.map((d) => d.id)).toEqual(["coke"]);
  });

  // A drink that's sold out shouldn't count as "they already have one" either.
  it("still asks when the only drink in the cart is now unavailable", () => {
    const menu = withItem("extras", "coke", { available: false });
    expect(findUpsells([plate()], { coke: 1 }, menu).drinks.map((d) => d.id)).toEqual(["water"]);
  });

  // kind comes from menu_options, so an untagged row is invisible to the
  // upsell rather than guessed at by name.
  it("ignores extras with no kind", () => {
    const menu = withoutKind("extras", "coke");
    expect(findUpsells([plate()], {}, menu).drinks.map((d) => d.id)).toEqual(["water"]);
  });

  it("has nothing to suggest for an empty cart", () => {
    expect(hasUpsells(findUpsells([], { coke: 1 }, STATIC_MENU))).toBe(false);
  });
});
