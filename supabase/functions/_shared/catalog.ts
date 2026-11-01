import type { SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import { PublicError } from "./http.ts";
import { leadDays } from "./schedule.ts";

export interface MenuOption {
  id: string;
  group_name: "size" | "heat" | "protein" | "customization" | "extra";
  label: string;
  price_cents: number;
  is_available: boolean;
}

export interface Settings {
  is_accepting_orders: boolean;
  closed_message: string;
  tax_rate: number;
  delivery_fee_cents: number;
  free_delivery_over_cents: number;
  free_delivery_min_lead_days: number;
  subscription_free_delivery: boolean;
  prep_minutes: number;
  slot_interval_minutes: number;
  delivery_radius_miles: number;
  origin_lat: number;
  origin_lng: number;
  origin_postal_code: string;
  pickup_address: string | null;
  contact_email: string;
  contact_phone: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  facebook_url: string | null;
  google_review_url: string | null;
}

export interface BusinessHour {
  day_of_week: number;
  is_closed: boolean;
  open_minute: number;
  close_minute: number;
}

export interface Catalog {
  options: Map<string, MenuOption>;
  settings: Settings;
  hours: BusinessHour[];
}

export async function loadCatalog(db: SupabaseClient): Promise<Catalog> {
  const [options, settings, hours] = await Promise.all([
    db.from("menu_options").select("id, group_name, label, price_cents, is_available"),
    db.from("settings").select("*").eq("id", 1).single(),
    db.from("business_hours").select("*").order("day_of_week"),
  ]);

  if (options.error) throw options.error;
  if (settings.error) throw settings.error;
  if (hours.error) throw hours.error;

  return {
    options: new Map((options.data as MenuOption[]).map((o) => [o.id, o])),
    // Postgres numerics arrive as strings over PostgREST; coerce the ones we do math on.
    settings: {
      ...(settings.data as Settings),
      tax_rate: Number(settings.data.tax_rate),
      delivery_radius_miles: Number(settings.data.delivery_radius_miles),
      free_delivery_min_lead_days: Number(settings.data.free_delivery_min_lead_days ?? 1),
      origin_lat: Number(settings.data.origin_lat),
      origin_lng: Number(settings.data.origin_lng),
    },
    hours: hours.data as BusinessHour[],
  };
}

// ----------------------------------------------------------------- cart ----

export interface PlateInput {
  size: string;
  heat: string;
  proteins?: Record<string, number>;
  customizations?: string[];
}

export interface CartInput {
  plates: PlateInput[];
  extras?: Record<string, number>;
  fulfillment: "pickup" | "delivery";
}

export interface PricedLine {
  kind: "plate" | "extra";
  label: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  config: Record<string, unknown>;
  sort_order: number;
}

/** Context the delivery-fee rule needs beyond the cart itself. */
export interface DeliveryTiming {
  /** When the food is due. null means ASAP. */
  scheduledFor: Date | null;
  now: Date;
  /** Weekly standing orders can skip the fee regardless of basket size. */
  isSubscription?: boolean;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  tax_rate: number;
  /** Why delivery was or wasn't free — surfaced to the UI, not just the total. */
  free_delivery: FreeDeliveryResult;
}

export interface FreeDeliveryResult {
  free: boolean;
  reason: "pickup" | "subscription" | "earned" | "needs_lead_time" | "needs_spend" | "needs_both";
  /** Cents still needed to reach the spend threshold, 0 once met. */
  shortfall_cents: number;
  lead_days_required: number;
}

/**
 * Free delivery now takes planning, not just a big basket: the order must
 * clear the spend threshold *and* be scheduled far enough ahead. Weekly
 * standing orders bypass both. Setting free_delivery_min_lead_days to 0
 * restores the old size-only rule.
 */
export function evaluateFreeDelivery(
  subtotal: number,
  settings: Settings,
  fulfillment: "pickup" | "delivery",
  timing: DeliveryTiming,
): FreeDeliveryResult {
  const required = settings.free_delivery_min_lead_days;
  const base = { lead_days_required: required, shortfall_cents: 0 };

  if (fulfillment === "pickup") return { ...base, free: true, reason: "pickup" };

  if (timing.isSubscription && settings.subscription_free_delivery) {
    return { ...base, free: true, reason: "subscription" };
  }

  // "$60 and over" is inclusive.
  const spendMet = subtotal >= settings.free_delivery_over_cents;
  const leadMet = leadDays(timing.scheduledFor, timing.now) >= required;
  const shortfall = spendMet ? 0 : settings.free_delivery_over_cents - subtotal;

  if (spendMet && leadMet) return { ...base, free: true, reason: "earned" };
  if (!spendMet && !leadMet) {
    return { ...base, free: false, reason: "needs_both", shortfall_cents: shortfall };
  }
  if (!leadMet) return { ...base, free: false, reason: "needs_lead_time" };
  return { ...base, free: false, reason: "needs_spend", shortfall_cents: shortfall };
}

const MAX_PLATES = 20;
const MAX_QTY = 20;

/** Looks an option up, rejecting unknown ids and anything marked sold out. */
function option(catalog: Catalog, id: unknown, group: MenuOption["group_name"]): MenuOption {
  if (typeof id !== "string") throw new PublicError(`Invalid ${group} selection.`);
  const found = catalog.options.get(id);
  if (!found || found.group_name !== group) throw new PublicError(`Unknown ${group}: ${id}`);
  if (!found.is_available) throw new PublicError(`${found.label} is sold out right now.`);
  return found;
}

function quantity(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new PublicError(`Invalid quantity for ${label}.`);
  if (n > MAX_QTY) throw new PublicError(`You can order at most ${MAX_QTY} of ${label}.`);
  return n;
}

/**
 * Re-prices the cart entirely from database rows. The client's own totals are
 * never read — it only says *what* it wants, never what it costs.
 */
export function priceOrder(
  catalog: Catalog,
  cart: CartInput,
  tipCents = 0,
  timing: DeliveryTiming = { scheduledFor: null, now: new Date() },
): PricedOrder {
  if (!Array.isArray(cart.plates) || cart.plates.length === 0) {
    throw new PublicError("Add at least one spaghetti plate to your order.");
  }
  if (cart.plates.length > MAX_PLATES) {
    throw new PublicError(`Orders are limited to ${MAX_PLATES} plates — call us for catering.`);
  }

  const lines: PricedLine[] = [];
  let subtotal = 0;
  let sort = 0;

  for (const plate of cart.plates) {
    const size = option(catalog, plate.size, "size");
    const heat = option(catalog, plate.heat, "heat");

    let price = size.price_cents + heat.price_cents;
    const parts: string[] = [heat.label];

    const proteins: Record<string, number> = {};
    for (const [id, rawQty] of Object.entries(plate.proteins ?? {})) {
      const protein = option(catalog, id, "protein");
      const qty = quantity(rawQty, protein.label);
      if (qty === 0) continue;
      proteins[id] = qty;
      price += protein.price_cents * qty;
      parts.push(qty > 1 ? `${qty}x ${protein.label}` : protein.label);
    }

    const customizations: string[] = [];
    for (const id of plate.customizations ?? []) {
      const custom = option(catalog, id, "customization");
      if (customizations.includes(custom.id)) continue;
      customizations.push(custom.id);
      price += custom.price_cents;
      parts.push(custom.label);
    }

    lines.push({
      kind: "plate",
      label: `${size.label} Spaghetti Plate`,
      quantity: 1,
      unit_price_cents: price,
      total_price_cents: price,
      config: {
        size: size.id,
        heat: heat.id,
        proteins,
        customizations,
        summary: parts.join(" · "),
      },
      sort_order: sort++,
    });
    subtotal += price;
  }

  for (const [id, rawQty] of Object.entries(cart.extras ?? {})) {
    const extra = option(catalog, id, "extra");
    const qty = quantity(rawQty, extra.label);
    if (qty === 0) continue;
    const total = extra.price_cents * qty;
    lines.push({
      kind: "extra",
      label: extra.label,
      quantity: qty,
      unit_price_cents: extra.price_cents,
      total_price_cents: total,
      config: { id: extra.id },
      sort_order: sort++,
    });
    subtotal += total;
  }

  const { settings } = catalog;
  const freeDelivery = evaluateFreeDelivery(subtotal, settings, cart.fulfillment, timing);
  const deliveryFee = freeDelivery.free ? 0 : settings.delivery_fee_cents;

  // Tax applies to food, not the delivery fee or the tip (California treats a
  // separately stated delivery charge as non-taxable).
  const tax = Math.round(subtotal * settings.tax_rate);

  const tip = Number.isInteger(tipCents) && tipCents >= 0 ? Math.min(tipCents, subtotal * 2) : 0;

  return {
    lines,
    subtotal_cents: subtotal,
    delivery_fee_cents: deliveryFee,
    tax_cents: tax,
    tip_cents: tip,
    total_cents: subtotal + deliveryFee + tax + tip,
    tax_rate: settings.tax_rate,
    free_delivery: freeDelivery,
  };
}
