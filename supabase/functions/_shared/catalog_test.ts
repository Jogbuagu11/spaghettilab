import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { priceOrder, type Catalog, type DeliveryTiming, type MenuOption } from "./catalog.ts";
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
      free_delivery_min_lead_days: 1,
      subscription_free_delivery: true,
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

// --- free delivery: $60+ AND scheduled at least a day ahead ---------------

const NOW = new Date("2026-11-02T20:00:00Z"); // noon PST
const laterToday = new Date("2026-11-03T02:00:00Z"); // 6pm PST, same kitchen day
const tomorrow = new Date("2026-11-03T20:00:00Z"); // noon PST, next day

const timing = (over: Partial<DeliveryTiming> = {}): DeliveryTiming => ({
  scheduledFor: null,
  now: NOW,
  ...over,
});

/** Exactly $60.00: two large plates plus four cokes. */
const sixtyDollarCart = {
  plates: [plate({ size: "large" }), plate({ size: "large" })],
  extras: { coke: 4 },
  fulfillment: "delivery" as const,
};

Deno.test("free delivery needs both the spend and the lead time", () => {
  const priced = priceOrder(catalog(), sixtyDollarCart, 0, timing({ scheduledFor: tomorrow }));
  assertEquals(priced.subtotal_cents, 6000);
  assertEquals(priced.delivery_fee_cents, 0);
  assertEquals(priced.free_delivery.reason, "earned");
});

Deno.test("$60 exactly qualifies — the threshold is inclusive", () => {
  const priced = priceOrder(catalog(), sixtyDollarCart, 0, timing({ scheduledFor: tomorrow }));
  assertEquals(priced.subtotal_cents, 6000);
  assertEquals(priced.free_delivery.free, true);
});

Deno.test("a big ASAP order still pays delivery", () => {
  const priced = priceOrder(catalog(), sixtyDollarCart, 0, timing());
  assertEquals(priced.delivery_fee_cents, 700);
  assertEquals(priced.free_delivery.reason, "needs_lead_time");
});

Deno.test("a big same-day scheduled order still pays delivery", () => {
  const priced = priceOrder(catalog(), sixtyDollarCart, 0, timing({ scheduledFor: laterToday }));
  assertEquals(priced.delivery_fee_cents, 700);
  assertEquals(priced.free_delivery.reason, "needs_lead_time");
});

Deno.test("scheduling ahead alone isn't enough below the threshold", () => {
  const priced = priceOrder(
    catalog(),
    { plates: [plate()], fulfillment: "delivery" },
    0,
    timing({ scheduledFor: tomorrow }),
  );
  assertEquals(priced.delivery_fee_cents, 700);
  assertEquals(priced.free_delivery.reason, "needs_spend");
  assertEquals(priced.free_delivery.shortfall_cents, 6000 - 1800);
});

Deno.test("a small ASAP order is told it needs both", () => {
  const priced = priceOrder(catalog(), { plates: [plate()], fulfillment: "delivery" }, 0, timing());
  assertEquals(priced.free_delivery.reason, "needs_both");
  assertEquals(priced.free_delivery.shortfall_cents, 4200);
});

Deno.test("evening-before counts as a day ahead, even though it is under 24h", () => {
  // 7pm Monday ordering for noon Tuesday: 17 hours, but a different kitchen day.
  const monday7pm = new Date("2026-11-03T03:00:00Z");
  const tuesdayNoon = new Date("2026-11-03T20:00:00Z");
  const priced = priceOrder(
    catalog(),
    sixtyDollarCart,
    0,
    timing({ now: monday7pm, scheduledFor: tuesdayNoon }),
  );
  assertEquals(priced.delivery_fee_cents, 0);
});

Deno.test("weekly standing orders never pay delivery", () => {
  const priced = priceOrder(
    catalog(),
    { plates: [plate()], fulfillment: "delivery" },
    0,
    timing({ isSubscription: true }),
  );
  assertEquals(priced.delivery_fee_cents, 0);
  assertEquals(priced.free_delivery.reason, "subscription");
});

Deno.test("the subscription perk can be switched off", () => {
  const priced = priceOrder(
    catalog({ subscription_free_delivery: false }),
    { plates: [plate()], fulfillment: "delivery" },
    0,
    timing({ isSubscription: true }),
  );
  assertEquals(priced.delivery_fee_cents, 700);
});

Deno.test("a zero lead requirement restores the size-only rule", () => {
  const priced = priceOrder(
    catalog({ free_delivery_min_lead_days: 0 }),
    sixtyDollarCart,
    0,
    timing(),
  );
  assertEquals(priced.delivery_fee_cents, 0);
});

Deno.test("never charges delivery for pickup", () => {
  const priced = priceOrder(catalog(), { plates: [plate()], fulfillment: "pickup" });
  assertEquals(priced.delivery_fee_cents, 0);
  assertEquals(priced.free_delivery.reason, "pickup");
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
