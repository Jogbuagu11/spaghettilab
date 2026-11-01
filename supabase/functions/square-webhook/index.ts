/**
 * Square webhook receiver.
 *
 * Keeps our records true when money moves outside our own flow — a refund
 * issued from the Square dashboard, a delayed capture, a dispute. The endpoint
 * is public, so every request is HMAC-verified before it is trusted.
 */
import { serviceClient } from "../_shared/db.ts";
import { requireEnv, SITE_URL } from "../_shared/env.ts";
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
    if (type === "payment.updated") {
      const payment = event.data?.object?.payment;
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
