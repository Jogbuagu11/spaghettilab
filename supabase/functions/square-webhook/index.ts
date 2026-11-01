/**
 * Square webhook receiver.
 *
 * Keeps our records true when money moves outside our own flow — a refund
 * issued from the Square dashboard, a delayed capture, a dispute. The endpoint
 * is public, so every request is HMAC-verified before it is trusted.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { kitchenAlert, orderConfirmation, type EmailOrder } from "../_shared/emails/templates.ts";
import { optionalEnv, requireEnv, SITE_URL } from "../_shared/env.ts";
import type { SquarePaymentResponse } from "../_shared/square.ts";

interface SquareWebhookEvent {
  type?: string;
  data?: {
    object?: {
      payment?: SquarePaymentResponse;
      refund?: { payment_id?: string; status?: string };
    };
  };
}

const encoder = new TextEncoder();

/**
 * Square signs `notification_url + raw_body` with HMAC-SHA256. The URL must be
 * byte-identical to the one registered in the Square dashboard.
 */
async function isValidSignature(
  rawBody: string,
  signature: string,
  notificationUrl: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireEnv("SQUARE_WEBHOOK_SIGNATURE_KEY")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(notificationUrl + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time compare: a fast reject leaks how much of the prefix matched.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") ?? "";
  const notificationUrl =
    Deno.env.get("SQUARE_WEBHOOK_URL") ??
    `${requireEnv("SUPABASE_URL")}/functions/v1/square-webhook`;

  if (!signature || !(await isValidSignature(rawBody, signature, notificationUrl))) {
    console.warn("rejected webhook with bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: SquareWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const db = serviceClient();
  const type = event.type;

  try {
    if (type === "payment.updated" || type === "payment.created") {
      const payment = event.data?.object?.payment;

      // Orders started in WhatsApp are paid through a Square-hosted link, so
      // this webhook is their only completion path — there's no browser to
      // return a token to us. Match on the order id the link was created with.
      if (payment?.id && payment.order_id && payment.status === "COMPLETED") {
        await completeLinkPaidOrder(db, payment);
      }

      if (payment?.id) {
        const refundedCents = payment.refunded_money?.amount ?? 0;
        const patch: Record<string, unknown> = {
          square_receipt_url: payment.receipt_url ?? null,
        };
        // Only drive status from Square for terminal money states; the kitchen
        // owns everything in between (preparing, ready, ...).
        if (payment.status === "COMPLETED" && refundedCents > 0) patch.status = "refunded";
        if (payment.status === "CANCELED" || payment.status === "FAILED")
          patch.status = "cancelled";

        await db.from("orders").update(patch).eq("square_payment_id", payment.id);
      }
    }

    if (type === "refund.created" || type === "refund.updated") {
      const refund = event.data?.object?.refund;
      if (refund?.payment_id && refund.status === "COMPLETED") {
        await db
          .from("orders")
          .update({ status: "refunded" })
          .eq("square_payment_id", refund.payment_id)
          .neq("status", "refunded");
      }
    }
  } catch (error) {
    // Return 500 so Square retries rather than dropping the event.
    console.error("webhook handling failed", type, error);
    return new Response("Handler error", { status: 500 });
  }

  // Square treats any 2xx as delivered.
  return new Response(JSON.stringify({ received: true, site: SITE_URL }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Finishes an order that was paid through a Square payment link.
 *
 * Only touches rows still awaiting payment, so a repeated webhook — Square
 * retries freely — can't re-send receipts or overwrite a later status set by
 * the kitchen. The email helper is idempotent on top of that.
 */
async function completeLinkPaidOrder(
  db: ReturnType<typeof serviceClient>,
  payment: SquarePaymentResponse,
): Promise<void> {
  const { data: order } = await db
    .from("orders")
    .select("id")
    .eq("square_order_id", payment.order_id!)
    .eq("status", "pending_payment")
    .maybeSingle();

  if (!order) return;

  const tipCents =
    (payment as unknown as { tip_money?: { amount?: number } }).tip_money?.amount ?? 0;
  const totalCents =
    (payment as unknown as { total_money?: { amount?: number } }).total_money?.amount ?? 0;

  const { data: updated } = await db
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      square_payment_id: payment.id,
      square_receipt_url: payment.receipt_url ?? null,
      card_brand: payment.card_details?.card?.card_brand ?? null,
      card_last4: payment.card_details?.card?.last_4 ?? null,
      // The hosted page collects the tip, so the totals are only known now.
      ...(tipCents ? { tip_cents: tipCents } : {}),
      ...(totalCents ? { total_cents: totalCents } : {}),
      payment_link_url: null,
    })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("*")
    .single();

  if (!updated) return;

  const { data: items } = await db
    .from("order_items")
    .select("label, quantity, unit_price_cents, total_price_cents, config, sort_order")
    .eq("order_id", order.id)
    .order("sort_order");

  const catalog = await loadCatalog(db);
  const ctx = {
    pickupAddress: catalog.settings.pickup_address,
    contactPhone: catalog.settings.contact_phone,
    googleReviewUrl: catalog.settings.google_review_url,
  };
  const emailOrder = { ...updated, items: items ?? [] } as EmailOrder;
  const kitchen = optionalEnv("KITCHEN_EMAIL");

  await Promise.allSettled([
    sendEmail(db, {
      to: updated.customer_email,
      email: orderConfirmation(emailOrder, ctx),
      template: "order_confirmation",
      orderId: order.id,
      once: true,
    }),
    kitchen
      ? sendEmail(db, {
          to: kitchen,
          email: kitchenAlert(emailOrder, ctx),
          template: "kitchen_alert",
          orderId: order.id,
          once: true,
          replyTo: updated.customer_email,
        })
      : Promise.resolve(false),
  ]);
}
