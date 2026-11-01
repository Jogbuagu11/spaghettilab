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
