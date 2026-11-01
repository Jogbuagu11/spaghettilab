import { describe, expect, it } from "vitest";
import {
  evaluateFreeDelivery,
  orderTotals,
  platePrice,
  roundCents,
  type Plate,
} from "@/lib/pricing";
import { availableSlots, canOrderAsap } from "@/lib/schedule";

const plate = (o: Partial<Plate> = {}): Plate => ({
  id: "1",
  size: "small",
  heat: "mild",
  proteins: {},
  customs: [],
  ...o,
});

// 2026-11-02 is PST (UTC-8).
const pst = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h + 8, m));

describe("pricing", () => {
  it("prices sizes 12/18/26", () => {
    expect(platePrice(plate())).toBe(1200);
    expect(platePrice(plate({ size: "medium" }))).toBe(1800);
    expect(platePrice(plate({ size: "large" }))).toBe(2600);
  });

  it("charges $4 per protein including repeats and $1 per customization", () => {
    expect(
      platePrice(plate({ proteins: { meatball: 2, sausage: 1 }, customs: ["mushroom"] })),
    ).toBe(1200 + 1200 + 100);
  });

  it("never charges delivery for pickup", () => {
    expect(orderTotals([plate()], {}, "pickup", 0).delivery).toBe(0);
  });
});

// Free delivery needs $60+ *and* a day's notice. The edge function enforces
// this for real; these cover the copy of the rule the UI prices with.
describe("free delivery", () => {
  const sixtyDollars = () => [plate({ size: "large" }), plate({ size: "large" })];
  const now = pst(12);
  const tomorrow = pst(36); // 24h out
  const inSixHours = pst(18); // under the 12h threshold

  it("waives delivery at $60 when scheduled 12+ hours ahead", () => {
    const t = orderTotals(sixtyDollars(), { coke: 4 }, "delivery", 0, undefined, {
      scheduledFor: tomorrow,
      now,
    });
    expect(t.subtotal).toBe(6000);
    expect(t.delivery).toBe(0);
    expect(t.freeDelivery.reason).toBe("earned");
  });

  it("still charges a big ASAP order", () => {
    const t = orderTotals(sixtyDollars(), { coke: 4 }, "delivery", 0, undefined, {
      scheduledFor: null,
      now,
    });
    expect(t.delivery).toBe(700);
    expect(t.freeDelivery.reason).toBe("needs_lead_time");
  });

  it("still charges a big order scheduled under 12 hours out", () => {
    const t = orderTotals(sixtyDollars(), { coke: 4 }, "delivery", 0, undefined, {
      scheduledFor: inSixHours,
      now,
    });
    expect(t.delivery).toBe(700);
    expect(t.freeDelivery.reason).toBe("needs_lead_time");
  });

  it("treats exactly 12 hours as qualifying", () => {
    const t = orderTotals(sixtyDollars(), { coke: 4 }, "delivery", 0, undefined, {
      scheduledFor: pst(24),
      now,
    });
    expect(t.delivery).toBe(0);
  });

  it("still charges a small order booked well ahead", () => {
    const t = orderTotals([plate()], {}, "delivery", 0, undefined, {
      scheduledFor: tomorrow,
      now,
    });
    expect(t.delivery).toBe(700);
    expect(t.freeDelivery.reason).toBe("needs_spend");
    expect(t.untilFree).toBe(6000 - 1200);
  });

  it("waives delivery for a weekly standing order of any size", () => {
    const result = evaluateFreeDelivery(1200, "delivery", undefined, {
      scheduledFor: null,
      now,
      isSubscription: true,
    });
    expect(result.free).toBe(true);
    expect(result.reason).toBe("subscription");
  });
});

describe("scheduling", () => {
  it("first slot is 12:15 when ordering before opening", () => {
    expect(availableSlots(pst(9))[0]).toMatchObject({ day: "today", minutes: 12 * 60 + 15 });
  });

  it("earliest slot is at least 15 minutes out", () => {
    expect(availableSlots(pst(14, 5))[0]?.minutes).toBe(14 * 60 + 30);
  });

  it("after close, only tomorrow slots", () => {
    expect(availableSlots(pst(21))[0]).toMatchObject({ day: "tomorrow", minutes: 735 });
  });

  it("ASAP only during open hours", () => {
    expect(canOrderAsap(pst(11, 59))).toBe(false);
    expect(canOrderAsap(pst(13))).toBe(true);
    expect(canOrderAsap(pst(20, 1))).toBe(false);
  });
});

// The quote shown at checkout must equal what Square charges to the cent, and
// Square settles itemised orders using half-to-even rounding. Math.round
// rounds half up and disagrees on a plain Small plate ($12.00 x 9.375% =
// 112.5c), which would get the payment rejected.
describe("tax rounding", () => {
  it("rounds half to even", () => {
    expect(roundCents(112.5)).toBe(112);
    expect(roundCents(113.5)).toBe(114);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(2.5)).toBe(2);
  });

  it("rounds normally away from the halfway point", () => {
    expect(roundCents(112.4)).toBe(112);
    expect(roundCents(112.6)).toBe(113);
    expect(roundCents(646.875)).toBe(647);
  });

  it("agrees with the figures Square returned for real baskets", () => {
    for (const [subtotal, square] of [
      [1200, 112],
      [1800, 169],
      [2600, 244],
      [6000, 562],
      [2000, 188],
      [16, 2],
    ] as const) {
      expect(roundCents(subtotal * 0.09375)).toBe(square);
    }
  });
});
