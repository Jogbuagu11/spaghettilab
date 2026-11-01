/**
 * Places and charges an order.
 *
 * The browser sends only *what* it wants — never prices. This function
 * re-prices the whole cart from the database, validates the time slot and
 * delivery radius, writes the order, then charges the Square token. The order
 * row is written before the charge so the id can serve as Square's idempotency
 * key: a retried request settles onto the same payment instead of charging twice.
 */
import { loadCatalog, priceOrder, type CartInput } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { kitchenAlert, orderConfirmation, type EmailOrder } from "../_shared/emails/templates.ts";
import { optionalEnv } from "../_shared/env.ts";
import { distanceMiles, geocode } from "../_shared/geo.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { resolveReadyTime } from "../_shared/schedule.ts";
import { createPayment } from "../_shared/square.ts";
import { optionalString, requireEmail, requirePhone, requireString } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = serviceClient();
  let orderId: string | null = null;

  try {
    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });

    const sourceId = requireString(payload.sourceId, "payment details", 2048);
    const customerName = requireString(payload.customer?.name, "name", 120);
    const customerEmail = requireEmail(payload.customer?.email);
    const customerPhone = requirePhone(payload.customer?.phone);
    const note = optionalString(payload.note, 500);

    const fulfillment = payload.fulfillment === "delivery" ? "delivery" : "pickup";
    const cart: CartInput = {
      plates: payload.plates,
      extras: payload.extras ?? {},
      fulfillment,
    };

    const catalog = await loadCatalog(db);
    if (!catalog.settings.is_accepting_orders) {
      throw new PublicError(catalog.settings.closed_message, 409);
    }

    const priced = priceOrder(catalog, cart, Number(payload.tipCents ?? 0));

    const { data: exceptionRows } = await db
      .from("schedule_exceptions")
      .select("exception_date, is_closed, open_minute, close_minute");
    const exceptions = new Map(
      (exceptionRows ?? []).map((r) => [
        // Match the yyyy-mm-dd key kitchenParts() builds.
        r.exception_date as string,
        { is_closed: r.is_closed, open_minute: r.open_minute, close_minute: r.close_minute },
      ]),
    );

    const now = new Date();
    const { readyAt, scheduledFor } = resolveReadyTime(
      catalog,
      exceptions,
      typeof payload.when === "string" ? payload.when : "asap",
      now,
    );

    // ------------------------------------------------- delivery radius ----
    let deliveryAddress: string | null = null;
    let deliveryLat: number | null = null;
    let deliveryLng: number | null = null;
    let deliveryDistance: number | null = null;

    if (fulfillment === "delivery") {
      const raw = requireString(payload.deliveryAddress, "delivery address", 300);
      const geo = await geocode(raw);
      const miles = distanceMiles(
        catalog.settings.origin_lat,
        catalog.settings.origin_lng,
        geo.lat,
        geo.lng,
      );
      if (miles > catalog.settings.delivery_radius_miles) {
        throw new PublicError(
          `Sorry — that address is ${miles.toFixed(1)} miles away and we only deliver within ` +
            `${catalog.settings.delivery_radius_miles} miles of ${catalog.settings.origin_postal_code}. ` +
            `Pickup is still available.`,
        );
      }
      deliveryAddress = geo.formatted;
      deliveryLat = geo.lat;
      deliveryLng = geo.lng;
      deliveryDistance = Number(miles.toFixed(2));
    }

    // ------------------------------------------------------ persist ------
    const { data: order, error: insertError } = await db
      .from("orders")
      .insert({
        status: "pending_payment",
        fulfillment,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        delivery_address: deliveryAddress,
        delivery_lat: deliveryLat,
        delivery_lng: deliveryLng,
        delivery_distance_mi: deliveryDistance,
        scheduled_for: scheduledFor?.toISOString() ?? null,
        ready_at: readyAt.toISOString(),
        subtotal_cents: priced.subtotal_cents,
        delivery_fee_cents: priced.delivery_fee_cents,
        tax_cents: priced.tax_cents,
        tip_cents: priced.tip_cents,
        total_cents: priced.total_cents,
        tax_rate: priced.tax_rate,
        customer_note: note,
      })
      .select("id, order_number, track_token")
      .single();

    if (insertError || !order) throw insertError ?? new Error("order insert failed");
    orderId = order.id;

    const { error: itemsError } = await db
      .from("order_items")
      .insert(priced.lines.map((line) => ({ order_id: order.id, ...line })));
    if (itemsError) throw itemsError;

    // ------------------------------------------------------- charge ------
    const charge = await createPayment({
      sourceId,
      amountCents: priced.total_cents,
      idempotencyKey: order.id,
      referenceId: order.order_number,
      note: `Spaghetti Lab ${order.order_number} (${fulfillment})`,
      buyerEmail: customerEmail,
      verificationToken:
        typeof payload.verificationToken === "string" ? payload.verificationToken : undefined,
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

    // ------------------------------------------------------- notify ------
    if (paid && updated) {
      const emailOrder: EmailOrder = { ...updated, items: priced.lines };
      const ctx = {
        pickupAddress: catalog.settings.pickup_address,
        contactPhone: catalog.settings.contact_phone,
        googleReviewUrl: catalog.settings.google_review_url,
      };

      // Fire both, but never let a mail failure fail a paid order.
      await Promise.allSettled([
        sendEmail(db, {
          to: customerEmail,
          email: orderConfirmation(emailOrder, ctx),
          template: "order_confirmation",
          orderId: order.id,
          once: true,
        }),
        optionalEnv("KITCHEN_EMAIL")
          ? sendEmail(db, {
              to: optionalEnv("KITCHEN_EMAIL"),
              email: kitchenAlert(emailOrder, ctx),
              template: "kitchen_alert",
              orderId: order.id,
              once: true,
              replyTo: customerEmail,
            })
          : Promise.resolve(false),
      ]);
    }

    return json(req, {
      orderNumber: order.order_number,
      trackToken: order.track_token,
      status: paid ? "paid" : "pending_payment",
      receiptUrl: charge.receiptUrl ?? null,
      totalCents: priced.total_cents,
    });
  } catch (error) {
    // A started-but-unpaid order would otherwise sit in the dashboard forever.
    if (orderId) {
      await db
        .from("orders")
        .update({
          status: "cancelled",
          cancellation_reason: error instanceof PublicError ? error.message : "Payment failed",
        })
        .eq("id", orderId)
        .eq("status", "pending_payment");
    }
    return fail(req, error);
  }
});
