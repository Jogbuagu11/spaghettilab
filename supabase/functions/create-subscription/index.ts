/**
 * Signs a customer up for a weekly standing order.
 *
 * Validates the basket and the weekly slot, vaults the card with Square, and
 * stores the schedule. Nothing is charged here — the first charge happens on
 * the first run, so a customer is never billed for food that's days away.
 */
import { loadCatalog, priceOrder, type CartInput } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { checkDeliveryAddress } from "../_shared/delivery.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { subscriptionConfirmed, type EmailSubscription } from "../_shared/emails/templates.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { formatMinutes, hoursFor, loadExceptions, nextWeeklyDate } from "../_shared/schedule.ts";
import { saveCardOnFile } from "../_shared/square.ts";
import { requireEmail, requirePhone, requireString } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = serviceClient();

  try {
    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });

    const sourceId = requireString(payload.sourceId, "payment details", 2048);
    const customer = {
      name: requireString(payload.customer?.name, "name", 120),
      email: requireEmail(payload.customer?.email),
      phone: requirePhone(payload.customer?.phone),
    };

    const fulfillment = payload.fulfillment === "delivery" ? "delivery" : "pickup";
    const cart: CartInput = {
      plates: payload.plates,
      extras: payload.extras ?? {},
      fulfillment,
    };

    const dayOfWeek = Number(payload.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new PublicError("Please choose a day of the week.");
    }

    const readyMinute = Number(payload.readyMinute);
    if (!Number.isInteger(readyMinute) || readyMinute < 0 || readyMinute > 1440) {
      throw new PublicError("Please choose a time.");
    }

    const catalog = await loadCatalog(db);
    if (!catalog.settings.is_accepting_orders) {
      throw new PublicError(catalog.settings.closed_message, 409);
    }

    // Price it once now purely as validation — unknown or sold-out options
    // should fail at signup, not silently every week.
    priceOrder(catalog, cart, 0, { scheduledFor: null, now: new Date(), isSubscription: true });

    // The chosen time must sit inside that weekday's normal hours.
    const day = hoursFor(catalog.hours, await loadExceptions(db), "", dayOfWeek);
    if (day.is_closed) {
      throw new PublicError("We're closed that day — please pick another.");
    }
    if (readyMinute % catalog.settings.slot_interval_minutes !== 0) {
      throw new PublicError("That time isn't one of our slots.");
    }
    if (
      readyMinute < day.open_minute + catalog.settings.slot_interval_minutes ||
      readyMinute > day.close_minute
    ) {
      throw new PublicError(
        `That time is outside our hours (${formatMinutes(day.open_minute)}–${formatMinutes(day.close_minute)}).`,
      );
    }

    const tipPercent = Math.min(100, Math.max(0, Number(payload.tipPercent ?? 0) || 0));

    let delivery = null;
    if (fulfillment === "delivery") {
      delivery = await checkDeliveryAddress(
        catalog,
        requireString(payload.deliveryAddress, "delivery address", 300),
      );
    }

    // Vault the card before writing the row: a declined card shouldn't leave a
    // subscription behind that can never charge.
    const saved = await saveCardOnFile({
      sourceId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      idempotencyKey: `${customer.email}-${dayOfWeek}-${readyMinute}`.slice(0, 45),
      postalCode: typeof payload.postalCode === "string" ? payload.postalCode : undefined,
    });

    const nextRunDate = nextWeeklyDate(dayOfWeek, new Date(), 1);

    const { data: subscription, error } = await db
      .from("subscriptions")
      .insert({
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        fulfillment,
        delivery_address: delivery?.address ?? null,
        delivery_lat: delivery?.lat ?? null,
        delivery_lng: delivery?.lng ?? null,
        delivery_distance_mi: delivery?.distanceMi ?? null,
        day_of_week: dayOfWeek,
        ready_minute: readyMinute,
        plates: cart.plates,
        extras: cart.extras ?? {},
        tip_percent: tipPercent,
        square_customer_id: saved.customerId,
        square_card_id: saved.cardId,
        card_brand: saved.brand ?? null,
        card_last4: saved.last4 ?? null,
        next_run_date: nextRunDate,
      })
      .select("*")
      .single();

    if (error || !subscription) throw error ?? new Error("subscription insert failed");

    await sendEmail(db, {
      to: customer.email,
      email: subscriptionConfirmed(subscription as EmailSubscription),
      template: "subscription_confirmed",
    });

    return json(req, {
      reference: subscription.reference,
      manageToken: subscription.manage_token,
      nextRunDate: subscription.next_run_date,
      cardBrand: subscription.card_brand,
      cardLast4: subscription.card_last4,
    });
  } catch (error) {
    return fail(req, error);
  }
});
