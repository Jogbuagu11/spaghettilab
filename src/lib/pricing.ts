import {
  STATIC_MENU,
  type CustomId,
  type ExtraId,
  type HeatId,
  type MenuData,
  type ProteinId,
  type SizeId,
} from "./menu";
import { TZ } from "./schedule";

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

export type FreeDeliveryReason =
  "pickup" | "subscription" | "earned" | "needs_lead_time" | "needs_spend" | "needs_both";

export interface FreeDeliveryResult {
  free: boolean;
  reason: FreeDeliveryReason;
  /** Cents still needed to reach the spend threshold; 0 once met. */
  shortfallCents: number;
  leadDaysRequired: number;
}

/** Context the free-delivery rule needs beyond the cart. */
export interface DeliveryTiming {
  /** When the food is due. null means ASAP. */
  scheduledFor: Date | null;
  now: Date;
  isSubscription?: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Calendar days of notice in the kitchen's timezone — 7pm Monday for noon
 * Tuesday counts as a day ahead even though it's under 24 hours. Mirrors
 * `leadDays()` in the edge functions; the server stays authoritative.
 */
export function leadDays(scheduledFor: Date | null, now: Date): number {
  if (!scheduledFor) return 0;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayIndex = (at: Date) =>
    Math.floor(Date.parse(`${formatter.format(at)}T00:00:00Z`) / DAY_MS);
  return Math.max(0, dayIndex(scheduledFor) - dayIndex(now));
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
  const base = { leadDaysRequired: menu.freeDeliveryMinLeadDays, shortfallCents: 0 };

  if (fulfillment === "pickup") return { ...base, free: true, reason: "pickup" };
  if (timing.isSubscription && menu.subscriptionFreeDelivery) {
    return { ...base, free: true, reason: "subscription" };
  }

  const spendMet = subtotal >= menu.freeDeliveryOver;
  const leadMet = leadDays(timing.scheduledFor, timing.now) >= menu.freeDeliveryMinLeadDays;
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
  const tax = Math.round(subtotal * taxRate);
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
