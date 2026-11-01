import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { Catalog } from "./catalog.ts";
import { PublicError } from "./http.ts";
import { kitchenTimeToUtc, resolveReadyTime } from "./schedule.ts";

// 2026-11-02 is PST (UTC-8); 2026-07-01 is PDT (UTC-7).
const pst = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 2, hour + 8, minute));

function catalog(closedDays: number[] = []): Catalog {
  return {
    options: new Map(),
    hours: Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d,
      is_closed: closedDays.includes(d),
      open_minute: 720, // 12:00
      close_minute: 1200, // 20:00
    })),
    settings: {
      is_accepting_orders: true,
      closed_message: "",
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
      contact_email: "",
      contact_phone: null,
      instagram_url: null,
      tiktok_url: null,
      facebook_url: null,
      google_review_url: null,
    },
  };
}

type Exceptions = Map<
  string,
  { is_closed: boolean; open_minute: number | null; close_minute: number | null }
>;
const noExceptions: Exceptions = new Map();

Deno.test("ASAP during open hours is ready after prep time", () => {
  const now = pst(13);
  const { readyAt, scheduledFor } = resolveReadyTime(catalog(), noExceptions, "asap", now);
  assertEquals(readyAt.getTime(), now.getTime() + 15 * 60_000);
  assertEquals(scheduledFor, null);
});

Deno.test("ASAP is refused before opening and after closing", () => {
  for (const hour of [9, 11, 21]) {
    assertThrows(
      () => resolveReadyTime(catalog(), noExceptions, "asap", pst(hour)),
      PublicError,
      "closed",
    );
  }
});

Deno.test("ASAP is refused when prep would run past closing", () => {
  // 19:50 + 15 min prep = 20:05, past the 20:00 close.
  assertThrows(() => resolveReadyTime(catalog(), noExceptions, "asap", pst(19, 50)), PublicError);
});

Deno.test("ASAP is refused on a closed day", () => {
  // 2026-11-02 is a Monday (day 1).
  assertThrows(
    () => resolveReadyTime(catalog([1]), noExceptions, "asap", pst(13)),
    PublicError,
    "closed",
  );
});

Deno.test("accepts a valid future slot", () => {
  const slot = kitchenTimeToUtc(2026, 11, 2, 15 * 60 + 30);
  const { readyAt, scheduledFor } = resolveReadyTime(
    catalog(),
    noExceptions,
    slot.toISOString(),
    pst(13),
  );
  assertEquals(readyAt.getTime(), slot.getTime());
  assertEquals(scheduledFor?.getTime(), slot.getTime());
});

Deno.test("rejects a slot inside the prep window", () => {
  // 13:05 is only 5 minutes out, under the 15-minute prep time.
  const slot = kitchenTimeToUtc(2026, 11, 2, 13 * 60 + 5);
  assertThrows(
    () => resolveReadyTime(catalog(), noExceptions, slot.toISOString(), pst(13)),
    PublicError,
    "at least",
  );
});

Deno.test("rejects a slot that isn't on the interval grid", () => {
  const slot = kitchenTimeToUtc(2026, 11, 2, 15 * 60 + 7);
  assertThrows(
    () => resolveReadyTime(catalog(), noExceptions, slot.toISOString(), pst(13)),
    PublicError,
    "slots",
  );
});

Deno.test("rejects a slot outside opening hours", () => {
  const tooLate = kitchenTimeToUtc(2026, 11, 2, 21 * 60);
  assertThrows(
    () => resolveReadyTime(catalog(), noExceptions, tooLate.toISOString(), pst(13)),
    PublicError,
    "outside our hours",
  );
});

Deno.test("rejects a slot more than a week out", () => {
  const far = kitchenTimeToUtc(2026, 11, 20, 15 * 60);
  assertThrows(
    () => resolveReadyTime(catalog(), noExceptions, far.toISOString(), pst(13)),
    PublicError,
    "days ahead",
  );
});

Deno.test("rejects a malformed timestamp", () => {
  assertThrows(
    () => resolveReadyTime(catalog(), noExceptions, "whenever", pst(13)),
    PublicError,
    "isn't valid",
  );
});

Deno.test("a one-off closure overrides the weekly hours", () => {
  const exceptions: Exceptions = new Map([
    ["2026-11-02", { is_closed: true, open_minute: null, close_minute: null }],
  ]);
  assertThrows(
    () => resolveReadyTime(catalog(), exceptions, "asap", pst(13)),
    PublicError,
    "closed",
  );
});

Deno.test("a one-off override can shorten the day", () => {
  const exceptions: Exceptions = new Map([
    ["2026-11-02", { is_closed: false, open_minute: 720, close_minute: 840 }], // close at 14:00
  ]);
  const slot = kitchenTimeToUtc(2026, 11, 2, 15 * 60);
  assertThrows(
    () => resolveReadyTime(catalog(), exceptions, slot.toISOString(), pst(13)),
    PublicError,
    "outside our hours",
  );
});

Deno.test("wall-clock conversion survives both sides of DST", () => {
  // PST: UTC-8.
  assertEquals(kitchenTimeToUtc(2026, 11, 2, 12 * 60).toISOString(), "2026-11-02T20:00:00.000Z");
  // PDT: UTC-7.
  assertEquals(kitchenTimeToUtc(2026, 7, 1, 12 * 60).toISOString(), "2026-07-01T19:00:00.000Z");
});
