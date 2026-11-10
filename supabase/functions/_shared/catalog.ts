import type { SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import { PublicError } from "./http.ts";
import { leadHours } from "./schedule.ts";

export interface MenuOption {
  id: string;
  group_name:
    | "size"
    | "heat"
    | "base"
    | "protein"
    | "customization"
    | "extra"
    | "sandwich"
    | "sandwich_size";
  label: string;
  description: string | null;
  price_cents: number;
  sort_order: number;
  is_available: boolean;
  /** Add-ons only: which products offer it. */
  applies_to: ("plate" | "sandwich")[] | null;
}

export interface Settings {
  is_accepting_orders: boolean;
  closed_message: string;
  tax_rate: number;
  delivery_fee_cents: number;
  free_delivery_over_cents: number;
  free_delivery_min_lead_hours: number;
  subscription_free_delivery: boolean;
  prep_minutes: number;
  slot_interval_minutes: number;
  delivery_per_hour_limit: number;
  queue_minutes_per_order: number;
  max_prep_minutes: number;
  late_cancel_fee_percent: number;
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
    db
      .from("menu_options")
      .select(
        "id, group_name, label, description, price_cents, sort_order, is_available, applies_to",
      ),
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
      free_delivery_min_lead_hours: Number(settings.data.free_delivery_min_lead_hours ?? 12),
      delivery_per_hour_limit: Number(settings.data.delivery_per_hour_limit ?? 3),
      queue_minutes_per_order: Number(settings.data.queue_minutes_per_order ?? 3),
      max_prep_minutes: Number(settings.data.max_prep_minutes ?? 90),
      late_cancel_fee_percent: Number(settings.data.late_cancel_fee_percent ?? 50),
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
  /**
   * What comes in the plate, free. Optional: carts built before this choice
   * existed don't carry one, and they predate any intent to skip the pork,
   * so they get the default the plate was always served with.
   */
  base?: string;
  proteins?: Record<string, number>;
  customizations?: string[];
}

export interface SandwichInput {
  size: string;
  filling: string;
  heat: string;
  customizations?: string[];
}

export interface CartInput {
  plates: PlateInput[];
  sandwiches?: SandwichInput[];
  extras?: Record<string, number>;
  fulfillment: "pickup" | "delivery";
}

/**
 * How a line is expressed to Square: a base item plus priced modifiers rather
 * than one collapsed amount. This is what makes Square receipts and the kitchen
 * ticket itemise by size and topping instead of printing a single total.
 */
export interface SquareLineBreakdown {
  name: string;
  variationName?: string;
  basePriceCents: number;
  modifiers: { name: string; priceCents: number; quantity: number }[];
}

export interface PricedLine {
  kind: "plate" | "sandwich" | "extra";
  label: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  config: Record<string, unknown>;
  sort_order: number;
  square: SquareLineBreakdown;
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
  lead_hours_required: number;
}

/**
 * Free delivery now takes planning, not just a big basket: the order must
 * clear the spend threshold *and* be scheduled far enough ahead. Weekly
 * standing orders bypass both. Setting free_delivery_min_lead_hours to 0
 * restores the size-only rule.
 */
export function evaluateFreeDelivery(
  subtotal: number,
  settings: Settings,
  fulfillment: "pickup" | "delivery",
  timing: DeliveryTiming,
): FreeDeliveryResult {
  const required = settings.free_delivery_min_lead_hours;
  const base = { lead_hours_required: required, shortfall_cents: 0 };

  if (fulfillment === "pickup") return { ...base, free: true, reason: "pickup" };

  if (timing.isSubscription && settings.subscription_free_delivery) {
    return { ...base, free: true, reason: "subscription" };
  }

  // "$60 and over" is inclusive.
  const spendMet = subtotal >= settings.free_delivery_over_cents;
  const leadMet = leadHours(timing.scheduledFor, timing.now) >= required;
  const shortfall = spendMet ? 0 : settings.free_delivery_over_cents - subtotal;

  if (spendMet && leadMet) return { ...base, free: true, reason: "earned" };
  if (!spendMet && !leadMet) {
    return { ...base, free: false, reason: "needs_both", shortfall_cents: shortfall };
  }
  if (!leadMet) return { ...base, free: false, reason: "needs_lead_time" };
  return { ...base, free: false, reason: "needs_spend", shortfall_cents: shortfall };
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

const MAX_PLATES = 20;
const MAX_QTY = 20;

/**
 * The base a plate comes with when none was chosen. Lowest sort_order wins, so
 * the kitchen can change the default from the admin without a deploy.
 */
function defaultBase(catalog: Catalog): string {
  let best: MenuOption | undefined;
  for (const o of catalog.options.values()) {
    if (o.group_name !== "base" || !o.is_available) continue;
    if (!best || o.sort_order < best.sort_order) best = o;
  }
  if (!best) throw new PublicError("The menu is misconfigured — please call us to order.");
  return best.id;
}

/** "sandwich" is the internal name; customers read "sub". */
const PRODUCT_LABEL: Record<"plate" | "sandwich", string> = { plate: "plate", sandwich: "sub" };

/**
 * An add-on, checked against the product it was asked for. Provolone on
 * spaghetti is a client that's lying or stale; either way it isn't on sale.
 */
function addOn(catalog: Catalog, id: unknown, product: "plate" | "sandwich"): MenuOption {
  const found = option(catalog, id, "customization");
  const appliesTo = found.applies_to ?? ["plate", "sandwich"];
  if (!appliesTo.includes(product)) {
    throw new PublicError(`${found.label} isn't available on a ${PRODUCT_LABEL[product]}.`);
  }
  return found;
}

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
  const sandwiches = Array.isArray(cart.sandwiches) ? cart.sandwiches : [];
  const plates = Array.isArray(cart.plates) ? cart.plates : [];
  // A sub is a meal too, so the gate is "something to eat", not "a plate".
  if (plates.length + sandwiches.length === 0) {
    throw new PublicError("Add a spaghetti plate or a sub to your order.");
  }
  if (plates.length + sandwiches.length > MAX_PLATES) {
    throw new PublicError(`Orders are limited to ${MAX_PLATES} items — call us for catering.`);
  }

  const lines: PricedLine[] = [];
  let subtotal = 0;
  let sort = 0;

  for (const plate of plates) {
    const size = option(catalog, plate.size, "size");
    const heat = option(catalog, plate.heat, "heat");
    // Single choice and free today, but priced from its row like everything
    // else — the client never gets to say what anything costs.
    const base = option(catalog, plate.base ?? defaultBase(catalog), "base");

    let price = size.price_cents + heat.price_cents + base.price_cents;
    const parts: string[] = [heat.label, base.label];
    const modifiers: SquareLineBreakdown["modifiers"] = [
      { name: heat.label, priceCents: heat.price_cents, quantity: 1 },
      { name: base.label, priceCents: base.price_cents, quantity: 1 },
    ];

    const proteins: Record<string, number> = {};
    for (const [id, rawQty] of Object.entries(plate.proteins ?? {})) {
      const protein = option(catalog, id, "protein");
      const qty = quantity(rawQty, protein.label);
      if (qty === 0) continue;
      proteins[id] = qty;
      price += protein.price_cents * qty;
      parts.push(qty > 1 ? `${qty}x ${protein.label}` : protein.label);
      modifiers.push({ name: protein.label, priceCents: protein.price_cents, quantity: qty });
    }

    const customizations: string[] = [];
    for (const id of plate.customizations ?? []) {
      const custom = addOn(catalog, id, "plate");
      if (customizations.includes(custom.id)) continue;
      customizations.push(custom.id);
      price += custom.price_cents;
      parts.push(custom.label);
      modifiers.push({ name: custom.label, priceCents: custom.price_cents, quantity: 1 });
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
        base: base.id,
        proteins,
        customizations,
        summary: parts.join(" · "),
      },
      sort_order: sort++,
      square: {
        name: "Spaghetti Plate",
        variationName: size.label,
        basePriceCents: size.price_cents,
        modifiers,
      },
    });
    subtotal += price;
  }

  for (const sandwich of sandwiches) {
    const size = option(catalog, sandwich.size, "sandwich_size");
    const filling = option(catalog, sandwich.filling, "sandwich");
    const heat = option(catalog, sandwich.heat, "heat");

    let price = size.price_cents + filling.price_cents + heat.price_cents;
    const parts: string[] = [heat.label];
    const modifiers: SquareLineBreakdown["modifiers"] = [
      { name: filling.label, priceCents: filling.price_cents, quantity: 1 },
      { name: heat.label, priceCents: heat.price_cents, quantity: 1 },
    ];

    const customizations: string[] = [];
    for (const id of sandwich.customizations ?? []) {
      const custom = addOn(catalog, id, "sandwich");
      if (customizations.includes(custom.id)) continue;
      customizations.push(custom.id);
      price += custom.price_cents;
      parts.push(custom.label);
      modifiers.push({ name: custom.label, priceCents: custom.price_cents, quantity: 1 });
    }

    // The inches are what the customer actually chose between, so they belong
    // on the receipt and the kitchen ticket, not just in the builder.
    const inches = size.description ? ` (${size.description})` : "";

    lines.push({
      kind: "sandwich",
      label: `${filling.label} Sub — ${size.label}${inches}`,
      quantity: 1,
      unit_price_cents: price,
      total_price_cents: price,
      config: {
        size: size.id,
        filling: filling.id,
        heat: heat.id,
        customizations,
        summary: parts.join(" · "),
      },
      sort_order: sort++,
      square: {
        name: "Sub",
        variationName: `${size.label}${inches}`,
        basePriceCents: size.price_cents,
        modifiers,
      },
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
      square: { name: extra.label, basePriceCents: extra.price_cents, modifiers: [] },
    });
    subtotal += total;
  }

  const { settings } = catalog;
  const freeDelivery = evaluateFreeDelivery(subtotal, settings, cart.fulfillment, timing);
  const deliveryFee = freeDelivery.free ? 0 : settings.delivery_fee_cents;

  // Tax applies to food, not the delivery fee or the tip (California treats a
  // separately stated delivery charge as non-taxable).
  const tax = roundCents(subtotal * settings.tax_rate);

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
