import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { priceOrder, type Catalog, type MenuOption } from "./catalog.ts";
import { PublicError } from "./http.ts";

const option = (
  id: string,
  group: MenuOption["group_name"],
  price: number,
  available = true,
): MenuOption => ({
  id,
  group_name: group,
  label: id,
  price_cents: price,
  is_available: available,
});

function catalog(overrides: Partial<Catalog["settings"]> = {}, soldOut: string[] = []): Catalog {
  const options = [
    option("small", "size", 1200),
    option("medium", "size", 1800),
    option("large", "size", 2600),
    option("spicy", "heat", 0),
    option("mild", "heat", 0),
    option("meatball", "protein", 400),
    option("sausage", "protein", 400),
    option("mushroom", "customization", 100),
    option("coke", "extra", 200),
  ].map((o) => (soldOut.includes(o.id) ? { ...o, is_available: false } : o));

  return {
    options: new Map(options.map((o) => [o.id, o])),
    hours: Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d,
      is_closed: false,
      open_minute: 720,
      close_minute: 1200,
    })),
    settings: {
      is_accepting_orders: true,
      closed_message: "closed",
      tax_rate: 0.09375,
      delivery_fee_cents: 700,
      free_delivery_over_cents: 6000,
      prep_minutes: 15,
      slot_interval_minutes: 15,
      delivery_radius_miles: 5,
      origin_lat: 37.3858,
      origin_lng: -121.8615,
      origin_postal_code: "95131",
      pickup_address: null,
      contact_email: "hello@spaghettilab.store",
      contact_phone: null,
      instagram_url: null,
      tiktok_url: null,
      facebook_url: null,
      google_review_url: null,
      ...overrides,
    },
  };
}

const plate = (extra: Record<string, unknown> = {}) => ({
  size: "medium",
  heat: "mild",
  proteins: {},
  customizations: [],
  ...extra,
});

Deno.test("prices a plate from database rows", () => {
  const priced = priceOrder(catalog(), { plates: [plate()], fulfillment: "pickup" });
  assertEquals(priced.subtotal_cents, 1800);
  assertEquals(priced.total_cents, 1800 + Math.round(1800 * 0.09375));
});

Deno.test("charges per protein unit and per customization", () => {
  const priced = priceOrder(catalog(), {
    plates: [plate({ proteins: { meatball: 2, sausage: 1 }, customizations: ["mushroom"] })],
    fulfillment: "pickup",
  });
  assertEquals(priced.subtotal_cents, 1800 + 1200 + 100);
});

Deno.test("ignores any price the client tries to send", () => {
  const priced = priceOrder(catalog(), {
    // A tampered payload: the extra fields must have no effect at all.
    plates: [{ ...plate(), price: 1, unit_price_cents: 1 } as never],
    extras: { coke: 1 },
    fulfillment: "pickup",
  });
  assertEquals(priced.subtotal_cents, 1800 + 200);
});

Deno.test("rejects unknown option ids", () => {
  assertThrows(
    () => priceOrder(catalog(), { plates: [plate({ size: "gigantic" })], fulfillment: "pickup" }),
    PublicError,
    "Unknown size",
  );
});

Deno.test("rejects an option from the wrong group", () => {
  assertThrows(
    () => priceOrder(catalog(), { plates: [plate({ size: "meatball" })], fulfillment: "pickup" }),
    PublicError,
    "Unknown size",
  );
});

Deno.test("rejects sold-out options", () => {
  assertThrows(
    () => priceOrder(catalog({}, ["medium"]), { plates: [plate()], fulfillment: "pickup" }),
    PublicError,
    "sold out",
  );
});

Deno.test("rejects an empty cart", () => {
  assertThrows(
    () => priceOrder(catalog(), { plates: [], fulfillment: "pickup" }),
    PublicError,
    "at least one",
  );
});

Deno.test("rejects negative and absurd quantities", () => {
  assertThrows(
    () =>
      priceOrder(catalog(), {
        plates: [plate({ proteins: { meatball: -5 } })],
        fulfillment: "pickup",
      }),
    PublicError,
  );
  assertThrows(
    () =>
      priceOrder(catalog(), { plates: [plate()], extras: { coke: 9999 }, fulfillment: "pickup" }),
    PublicError,
  );
});

Deno.test("deduplicates repeated customizations", () => {
  const priced = priceOrder(catalog(), {
    plates: [plate({ customizations: ["mushroom", "mushroom", "mushroom"] })],
    fulfillment: "pickup",
  });
  assertEquals(priced.subtotal_cents, 1800 + 100);
});

Deno.test("charges delivery at or below the free threshold, waives it above", () => {
  const atThreshold = priceOrder(catalog(), {
    plates: [plate({ size: "large" }), plate({ size: "large" })],
    extras: { coke: 4 },
    fulfillment: "delivery",
  });
  assertEquals(atThreshold.subtotal_cents, 6000);
  assertEquals(atThreshold.delivery_fee_cents, 700);

  const above = priceOrder(catalog(), {
    plates: [plate({ size: "large" }), plate({ size: "large" })],
    extras: { coke: 5 },
    fulfillment: "delivery",
  });
  assertEquals(above.delivery_fee_cents, 0);
});

Deno.test("never charges delivery for pickup", () => {
  const priced = priceOrder(catalog(), { plates: [plate()], fulfillment: "pickup" });
  assertEquals(priced.delivery_fee_cents, 0);
});

Deno.test("taxes food only — not delivery or tip", () => {
  const priced = priceOrder(catalog(), { plates: [plate()], fulfillment: "delivery" }, 500);
  assertEquals(priced.subtotal_cents, 1800);
  assertEquals(priced.delivery_fee_cents, 700);
  assertEquals(priced.tax_cents, Math.round(1800 * 0.09375));
  assertEquals(priced.tip_cents, 500);
  assertEquals(priced.total_cents, 1800 + 700 + Math.round(1800 * 0.09375) + 500);
});

Deno.test("clamps a nonsensical tip and ignores a negative one", () => {
  assertEquals(
    priceOrder(catalog(), { plates: [plate()], fulfillment: "pickup" }, -100).tip_cents,
    0,
  );
  // Capped at 2x subtotal so a fat-fingered tip can't become the whole charge.
  assertEquals(
    priceOrder(catalog(), { plates: [plate()], fulfillment: "pickup" }, 999_999).tip_cents,
    3600,
  );
});

Deno.test("caps the number of plates per order", () => {
  assertThrows(
    () => priceOrder(catalog(), { plates: Array(21).fill(plate()), fulfillment: "pickup" }),
    PublicError,
    "limited to",
  );
});
