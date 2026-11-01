import {
  STATIC_MENU,
  type CustomId,
  type ExtraId,
  type HeatId,
  type MenuData,
  type ProteinId,
  type SizeId,
} from "./menu";

export interface Plate {
  id: string;
  size: SizeId;
  heat: HeatId;
  proteins: Partial<Record<ProteinId, number>>;
  customs: CustomId[];
}

export type Fulfillment = "pickup" | "delivery";

// Every function takes the live menu, defaulting to the build-time one so
// callers that only need the standard prices (and the tests) stay unchanged.

export function platePrice(p: Plate, menu: MenuData = STATIC_MENU): number {
  const size = menu.sizes.find((s) => s.id === p.size)?.price ?? 0;
  const proteins = menu.proteins.reduce(
    (sum, pr) => sum + pr.price * (p.proteins[pr.id as ProteinId] ?? 0),
    0,
  );
  const customs = menu.customizations
    .filter((c) => p.customs.includes(c.id as CustomId))
    .reduce((sum, c) => sum + c.price, 0);
  return size + proteins + customs;
}

export function extrasPrice(
  extras: Partial<Record<ExtraId, number>>,
  menu: MenuData = STATIC_MENU,
): number {
  return menu.extras.reduce((sum, e) => sum + e.price * (extras[e.id as ExtraId] ?? 0), 0);
}

/**
 * Rounds half to even ("banker's rounding").
 *
 * This matches Square's tax arithmetic, and that match is load-bearing: when
 * an order is paid through the Orders API the payment amount must equal the
 * order total exactly. Math.round rounds half *up*, which disagrees with
 * Square on any half-cent — a plain Small plate is one ($12.00 x 9.375% =
 * 112.5c, where we'd have said 113 and Square says 112) and the payment would
 * be rejected.
 */
export function roundCents(value: number): number {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export type FreeDeliveryReason =
  "pickup" | "subscription" | "earned" | "needs_lead_time" | "needs_spend" | "needs_both";

export interface FreeDeliveryResult {
  free: boolean;
  reason: FreeDeliveryReason;
  /** Cents still needed to reach the spend threshold; 0 once met. */
  shortfallCents: number;
  leadHoursRequired: number;
}

/** Context the free-delivery rule needs beyond the cart. */
export interface DeliveryTiming {
  /** When the food is due. null means ASAP. */
  scheduledFor: Date | null;
  now: Date;
  isSubscription?: boolean;
}

/**
 * Hours of notice between now and a scheduled time. ASAP is 0. Mirrors
 * `leadHours()` in the edge functions; the server stays authoritative.
 */
export function leadHours(scheduledFor: Date | null, now: Date): number {
  if (!scheduledFor) return 0;
  return Math.max(0, (scheduledFor.getTime() - now.getTime()) / 3_600_000);
}

const ASAP = (): DeliveryTiming => ({ scheduledFor: null, now: new Date() });

/**
 * Free delivery takes planning, not just a big basket: the order must clear the
 * spend threshold ($60 and over, inclusive) *and* be scheduled far enough
 * ahead. Weekly standing orders bypass both.
 */
export function evaluateFreeDelivery(
  subtotal: number,
  fulfillment: Fulfillment,
  menu: MenuData = STATIC_MENU,
  timing: DeliveryTiming = ASAP(),
): FreeDeliveryResult {
  const base = { leadHoursRequired: menu.freeDeliveryMinLeadHours, shortfallCents: 0 };

  if (fulfillment === "pickup") return { ...base, free: true, reason: "pickup" };
  if (timing.isSubscription && menu.subscriptionFreeDelivery) {
    return { ...base, free: true, reason: "subscription" };
  }

  const spendMet = subtotal >= menu.freeDeliveryOver;
  const leadMet = leadHours(timing.scheduledFor, timing.now) >= menu.freeDeliveryMinLeadHours;
  const shortfallCents = spendMet ? 0 : menu.freeDeliveryOver - subtotal;

  if (spendMet && leadMet) return { ...base, free: true, reason: "earned" };
  if (!spendMet && !leadMet) return { ...base, free: false, reason: "needs_both", shortfallCents };
  if (!leadMet) return { ...base, free: false, reason: "needs_lead_time" };
  return { ...base, free: false, reason: "needs_spend", shortfallCents };
}

export function deliveryFee(
  subtotal: number,
  fulfillment: Fulfillment,
  menu: MenuData = STATIC_MENU,
  timing: DeliveryTiming = ASAP(),
): number {
  return evaluateFreeDelivery(subtotal, fulfillment, menu, timing).free ? 0 : menu.deliveryFee;
}

export function orderTotals(
  plates: Plate[],
  extras: Partial<Record<ExtraId, number>>,
  fulfillment: Fulfillment,
  taxRate: number,
  menu: MenuData = STATIC_MENU,
  timing: DeliveryTiming = ASAP(),
) {
  const subtotal = plates.reduce((s, p) => s + platePrice(p, menu), 0) + extrasPrice(extras, menu);
  const freeDelivery = evaluateFreeDelivery(subtotal, fulfillment, menu, timing);
  const delivery = freeDelivery.free ? 0 : menu.deliveryFee;
  const tax = roundCents(subtotal * taxRate);
  return {
    subtotal,
    delivery,
    tax,
    total: subtotal + delivery + tax,
    freeDelivery,
    /** Cents still needed to hit the spend threshold. */
    untilFree: freeDelivery.shortfallCents,
  };
}
