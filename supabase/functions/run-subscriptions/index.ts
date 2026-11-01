/**
 * Weekly standing-order sweep. Scheduled (see supabase/cron-subscriptions.sql)
 * to run each morning; it picks up every subscription due today and charges the
 * saved card.
 *
 * Each run re-prices against the live menu rather than a frozen total, so a
 * price change or a sold-out topping is reflected automatically. The order id
 * is Square's idempotency key, so a double-fired cron can't double-charge.
 */
import { loadCatalog, type CartInput } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { subscriptionPaymentFailed, type EmailSubscription } from "../_shared/emails/templates.ts";
import { requireEnv } from "../_shared/env.ts";
import { placeAndChargeOrder } from "../_shared/place-order.ts";
import { dateKeyToInstant, kitchenDateKey, nextWeeklyDate } from "../_shared/schedule.ts";

/** Consecutive declines before we stop trying and pause the subscription. */
const MAX_FAILURES = 3;
const BATCH = 100;

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (auth !== requireEnv("SUPABASE_SERVICE_ROLE_KEY")) {
    return new Response("Not authorised", { status: 401 });
  }

  const db = serviceClient();
  const now = new Date();
  const today = kitchenDateKey(now);

  const { data: due, error } = await db
    .from("subscriptions")
    .select("*")
    .in("status", ["active", "payment_failed"])
    .lte("next_run_date", today)
    .limit(BATCH);

  if (error) {
    console.error(error);
    return new Response("Query failed", { status: 500 });
  }

  const catalog = await loadCatalog(db);
  const result = { due: due?.length ?? 0, charged: 0, skipped: 0, failed: 0 };

  for (const sub of due ?? []) {
    const runDate: string = sub.next_run_date;
    const advance = () =>
      db
        .from("subscriptions")
        .update({
          next_run_date: nextWeeklyDate(sub.day_of_week, dateKeyToInstant(runDate, 720), 1),
        })
        .eq("id", sub.id);

    // The customer asked to skip this one.
    const { data: skip } = await db
      .from("subscription_skips")
      .select("skip_date")
      .eq("subscription_id", sub.id)
      .eq("skip_date", runDate)
      .maybeSingle();

    if (skip) {
      await advance();
      result.skipped++;
      continue;
    }

    // Don't silently sell food that's been taken off the menu.
    if (!catalog.settings.is_accepting_orders) {
      await advance();
      result.skipped++;
      continue;
    }

    const cart: CartInput = {
      plates: sub.plates,
      extras: sub.extras ?? {},
      fulfillment: sub.fulfillment,
    };
    const readyAt = dateKeyToInstant(runDate, sub.ready_minute);

    try {
      const placed = await placeAndChargeOrder(db, catalog, {
        cart,
        customer: {
          name: sub.customer_name,
          email: sub.customer_email,
          phone: sub.customer_phone,
        },
        delivery:
          sub.fulfillment === "delivery"
            ? {
                address: sub.delivery_address,
                lat: Number(sub.delivery_lat),
                lng: Number(sub.delivery_lng),
                distanceMi: Number(sub.delivery_distance_mi),
              }
            : null,
        readyAt,
        scheduledFor: readyAt,
        // Stored as a percentage so the tip tracks menu price changes.
        tipPercent: sub.tip_percent ?? 0,
        note: `Weekly standing order ${sub.reference}`,
        now,
        payment: { sourceId: sub.square_card_id, customerId: sub.square_customer_id },
        subscriptionId: sub.id,
      });

      await db
        .from("subscriptions")
        .update({
          status: "active",
          failure_count: 0,
          last_error: null,
          last_order_id: placed.order.id,
          last_charged_at: new Date().toISOString(),
          next_run_date: nextWeeklyDate(sub.day_of_week, dateKeyToInstant(runDate, 720), 1),
        })
        .eq("id", sub.id);

      result.charged++;
    } catch (chargeError) {
      const failures = (sub.failure_count ?? 0) + 1;
      const exhausted = failures >= MAX_FAILURES;

      await db
        .from("subscriptions")
        .update({
          status: exhausted ? "paused" : "payment_failed",
          failure_count: failures,
          last_error: String(chargeError).slice(0, 500),
          next_run_date: nextWeeklyDate(sub.day_of_week, dateKeyToInstant(runDate, 720), 1),
        })
        .eq("id", sub.id);

      await sendEmail(db, {
        to: sub.customer_email,
        email: subscriptionPaymentFailed(sub as EmailSubscription, MAX_FAILURES - failures),
        template: `subscription_failed_${failures}`,
      });

      console.error(`subscription ${sub.reference} failed`, chargeError);
      result.failed++;
    }
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
