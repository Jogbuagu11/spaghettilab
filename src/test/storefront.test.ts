import { describe, expect, it } from "vitest";
import { SETTINGS_COLUMNS } from "@/lib/storefront";

/**
 * `settings` is exposed to the browser through a column-level grant, which has
 * two sharp edges these tests guard:
 *
 *  - asking for a column anon can't read fails the *whole* query, so the
 *    storefront silently falls back to defaults;
 *  - asking for `*` does exactly that the moment a private column exists.
 */
describe("storefront settings query", () => {
  const columns = SETTINGS_COLUMNS.split(",");

  it("never requests the pickup address", () => {
    // Only disclosed after payment, via the track-order edge function.
    expect(columns).not.toContain("pickup_address");
  });

  it("never requests admin-only columns", () => {
    for (const col of ["pickup_address", "updated_at", "id"]) {
      expect(SETTINGS_COLUMNS).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("asks for an explicit list rather than a wildcard", () => {
    expect(SETTINGS_COLUMNS).not.toContain("*");
    expect(columns.length).toBeGreaterThan(10);
  });

  it("includes the fields the delivery rule depends on", () => {
    for (const col of [
      "tax_rate",
      "delivery_fee_cents",
      "free_delivery_over_cents",
      "free_delivery_min_lead_hours",
      "subscription_free_delivery",
    ]) {
      expect(columns).toContain(col);
    }
  });
});

import { minutesOverdue } from "@/lib/api";

// A kitchen tablet sits open for hours, so lateness is computed from the
// clock on every render rather than from anything stored.
describe("overdue detection", () => {
  const readyAt = "2026-11-02T02:00:00.000Z";
  const at = (minutesAfter: number) => new Date(Date.parse(readyAt) + minutesAfter * 60_000);

  it("reports nothing before the promised time", () => {
    expect(minutesOverdue(readyAt, "preparing", at(-5))).toBeNull();
    expect(minutesOverdue(readyAt, "preparing", at(0))).toBeNull();
  });

  it("counts whole minutes past it", () => {
    expect(minutesOverdue(readyAt, "preparing", at(1))).toBe(1);
    expect(minutesOverdue(readyAt, "preparing", at(18))).toBe(18);
  });

  it("ignores orders the kitchen is done with", () => {
    for (const status of ["completed", "cancelled", "refunded", "pending_payment"]) {
      expect(minutesOverdue(readyAt, status, at(60))).toBeNull();
    }
  });

  it("still flags an out-for-delivery order that's late", () => {
    expect(minutesOverdue(readyAt, "out_for_delivery", at(12))).toBe(12);
  });

  it("handles an order with no ready time", () => {
    expect(minutesOverdue(null, "preparing", at(60))).toBeNull();
  });
});
