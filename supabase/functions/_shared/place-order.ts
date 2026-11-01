import type { SupabaseClient } from "@supabase/supabase-js";
import { priceOrder, type Catalog, type CartInput, type PricedOrder } from "./catalog.ts";
import { sendEmail } from "./emails/send.ts";
import { kitchenAlert, orderConfirmation, type EmailOrder } from "./emails/templates.ts";
import { optionalEnv } from "./env.ts";
import { PublicError } from "./http.ts";
import { createPayment, type ChargeResult } from "./square.ts";

export interface DeliveryDetails {
  address: string;
  lat: number;
  lng: number;
  distanceMi: number;
}

export interface PlaceOrderInput {
  cart: CartInput;
  customer: { name: string; email: string; phone: string };
  delivery: DeliveryDetails | null;
  readyAt: Date;
  scheduledFor: Date | null;
  /** Fixed tip in cents. Ignored when tipPercent is given. */
  tipCents?: number;
  /** Percentage tip, resolved against the freshly computed subtotal. Weekly
   *  orders store a percentage so the tip tracks menu price changes. */
  tipPercent?: number;
  note: string | null;
  now: Date;
  payment: {
    /** A single-use token, or a saved card id for a weekly run. */
    sourceId: string;
    customerId?: string;
    verificationToken?: string;
  };
  /** Set for weekly runs: unlocks the free-delivery perk and links the order. */
  subscriptionId?: string;
}

export interface PlacedOrder {
  order: Record<string, unknown>;
  priced: PricedOrder;
  charge: ChargeResult;
  paid: boolean;
}

/**
 * Prices, persists, charges and confirms an order.
 *
 * Shared by checkout and the weekly subscription run so both get identical
 * pricing, identical idempotency and identical emails — there is exactly one
 * place where an order becomes real.
 *
 * The row is written *before* the charge so its id can be Square's idempotency
 * key: a retried request settles onto the same payment instead of charging twice.
 */
export async function placeAndChargeOrder(
  db: SupabaseClient,
  catalog: Catalog,
  input: PlaceOrderInput,
): Promise<PlacedOrder> {
  const timing = {
    scheduledFor: input.scheduledFor,
    now: input.now,
    isSubscription: Boolean(input.subscriptionId),
  };

  // A percentage tip needs the subtotal, which only pricing can tell us — so
  // price once at zero tip, then again with the resolved amount.
  let tipCents = input.tipCents ?? 0;
  if (input.tipPercent !== undefined) {
    const dryRun = priceOrder(catalog, input.cart, 0, timing);
    tipCents = Math.round(dryRun.subtotal_cents * (input.tipPercent / 100));
  }

  const priced = priceOrder(catalog, input.cart, tipCents, timing);

  const { data: order, error: insertError } = await db
    .from("orders")
    .insert({
      status: "pending_payment",
      fulfillment: input.cart.fulfillment,
      customer_name: input.customer.name,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone,
      delivery_address: input.delivery?.address ?? null,
      delivery_lat: input.delivery?.lat ?? null,
      delivery_lng: input.delivery?.lng ?? null,
      delivery_distance_mi: input.delivery?.distanceMi ?? null,
      scheduled_for: input.scheduledFor?.toISOString() ?? null,
      ready_at: input.readyAt.toISOString(),
      subtotal_cents: priced.subtotal_cents,
      delivery_fee_cents: priced.delivery_fee_cents,
      tax_cents: priced.tax_cents,
      tip_cents: priced.tip_cents,
      total_cents: priced.total_cents,
      tax_rate: priced.tax_rate,
      customer_note: input.note,
      subscription_id: input.subscriptionId ?? null,
    })
    .select("id, order_number, track_token")
    .single();

  if (insertError || !order) throw insertError ?? new Error("order insert failed");

  try {
    const { error: itemsError } = await db
      .from("order_items")
      .insert(priced.lines.map((line) => ({ order_id: order.id, ...line })));
    if (itemsError) throw itemsError;

    const charge = await createPayment({
      sourceId: input.payment.sourceId,
      customerId: input.payment.customerId,
      amountCents: priced.total_cents,
      idempotencyKey: order.id,
      referenceId: order.order_number,
      note: `Spaghetti Lab ${order.order_number} (${input.cart.fulfillment})`,
      buyerEmail: input.customer.email,
      verificationToken: input.payment.verificationToken,
    });

    const paid = charge.status === "COMPLETED" || charge.status === "APPROVED";

    const { data: updated } = await db
      .from("orders")
      .update({
        status: paid ? "paid" : "pending_payment",
        paid_at: paid ? new Date().toISOString() : null,
        square_payment_id: charge.paymentId,
        square_order_id: charge.orderId ?? null,
        square_receipt_url: charge.receiptUrl ?? null,
        card_brand: charge.cardBrand ?? null,
        card_last4: charge.last4 ?? null,
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (paid && updated) {
      await notify(db, catalog, { ...updated, items: priced.lines } as EmailOrder, order.id);
    }

    return { order: updated ?? order, priced, charge, paid };
  } catch (error) {
    // Don't leave a started-but-unpaid order sitting in the dashboard.
    await db
      .from("orders")
      .update({
        status: "cancelled",
        cancellation_reason: error instanceof PublicError ? error.message : "Payment failed",
      })
      .eq("id", order.id)
      .eq("status", "pending_payment");
    throw error;
  }
}

/** Receipt to the customer, ticket to the kitchen. Neither can fail the order. */
async function notify(
  db: SupabaseClient,
  catalog: Catalog,
  emailOrder: EmailOrder,
  orderId: string,
): Promise<void> {
  const ctx = {
    pickupAddress: catalog.settings.pickup_address,
    contactPhone: catalog.settings.contact_phone,
    googleReviewUrl: catalog.settings.google_review_url,
  };
  const kitchen = optionalEnv("KITCHEN_EMAIL");

  await Promise.allSettled([
    sendEmail(db, {
      to: emailOrder.customer_email ?? "",
      email: orderConfirmation(emailOrder, ctx),
      template: "order_confirmation",
      orderId,
      once: true,
    }),
    kitchen
      ? sendEmail(db, {
          to: kitchen,
          email: kitchenAlert(emailOrder, ctx),
          template: "kitchen_alert",
          orderId,
          once: true,
          replyTo: emailOrder.customer_email ?? undefined,
        })
      : Promise.resolve(false),
  ]);
}
