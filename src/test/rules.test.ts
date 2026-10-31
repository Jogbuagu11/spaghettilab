import { describe, expect, it } from "vitest";
import { orderTotals, platePrice, type Plate } from "@/lib/pricing";
import { availableSlots, canOrderAsap } from "@/lib/schedule";

const plate = (o: Partial<Plate> = {}): Plate => ({
  id: "1", size: "small", heat: "mild", proteins: {}, customs: [], ...o,
});
// 2026-11-02 is PST (UTC-8)
const pst = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h + 8, m));

describe("pricing", () => {
  it("prices sizes 12/18/26", () => {
    expect(platePrice(plate())).toBe(1200);
    expect(platePrice(plate({ size: "medium" }))).toBe(1800);
    expect(platePrice(plate({ size: "large" }))).toBe(2600);
  });
  it("charges $4 per protein including repeats and $1 per customization", () => {
    expect(platePrice(plate({ proteins: { meatball: 2, sausage: 1 }, customs: ["mushroom"] }))).toBe(
      1200 + 1200 + 100,
    );
  });
  it("charges $7 delivery at $60 or less", () => {
    const t = orderTotals([plate({ size: "large" }), plate({ size: "large" })], { coke: 4 }, "delivery", 0);
    expect(t.subtotal).toBe(6000);
    expect(t.delivery).toBe(700);
  });
  it("waives delivery over $60 pre-tax", () => {
    const t = orderTotals([plate({ size: "large" }), plate({ size: "large" })], { coke: 5 }, "delivery", 0.1);
    expect(t.delivery).toBe(0);
  });
  it("never charges delivery for pickup", () => {
    expect(orderTotals([plate()], {}, "pickup", 0).delivery).toBe(0);
  });
});

describe("scheduling", () => {
  it("first slot is 12:15 when ordering before opening", () => {
    expect(availableSlots(pst(9))[0]).toMatchObject({ day: "today", minutes: 12 * 60 + 15 });
  });
  it("earliest slot is at least 15 minutes out", () => {
    expect(availableSlots(pst(14, 5))[0].minutes).toBe(14 * 60 + 30);
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
