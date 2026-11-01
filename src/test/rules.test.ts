import { describe, expect, it } from "vitest";
import { evaluateFreeDelivery, orderTotals, platePrice, type Plate } from "@/lib/pricing";
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
  const tomorrow = pst(36); // noon the next day
  const laterToday = pst(18);

  it("waives delivery at $60 when scheduled a day ahead", () => {
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

  it("still charges a big same-day scheduled order", () => {
    const t = orderTotals(sixtyDollars(), { coke: 4 }, "delivery", 0, undefined, {
      scheduledFor: laterToday,
      now,
    });
    expect(t.delivery).toBe(700);
  });

  it("still charges a small order booked a day ahead", () => {
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
