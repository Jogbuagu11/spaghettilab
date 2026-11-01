/**
 * WhatsApp Cloud API webhook.
 *
 * Handles two things:
 *  - a completed order Flow, which becomes a real priced order plus a Square
 *    checkout link sent back into the chat;
 *  - any other inbound message, which gets a nudge to open the Flow.
 *
 * Meta retries on any non-2xx, so this answers 200 quickly and treats its own
 * failures as "log and move on" rather than asking to be replayed — a replay
 * would create a second order.
 */
import { loadCatalog, type CartInput } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { checkDeliveryAddress } from "../_shared/delivery.ts";
import { optionalEnv } from "../_shared/env.ts";
import { PublicError } from "../_shared/http.ts";
import { createPendingOrder } from "../_shared/place-order.ts";
import { loadExceptions, resolveReadyTime } from "../_shared/schedule.ts";
import { isValidSignature, sendFlowPrompt, sendPayLink, sendText } from "../_shared/whatsapp.ts";
import { requireEmail, requirePhone, requireString } from "../_shared/validate.ts";

/** Shape the published Flow submits. Mirrors scripts/whatsapp-flow-publish.mjs. */
interface FlowSubmission {
  size?: string;
  quantity?: string;
  heat?: string;
  proteins?: string[];
  customizations?: string[];
  extras?: string[];
  fulfillment?: string;
  address?: string;
  when?: string;
  name?: string;
  email?: string;
  phone?: string;
  note?: string;
}

/** A Flow checkbox returns ids; proteins are one each from this screen. */
const toQuantities = (ids: string[] | undefined) =>
  Object.fromEntries((ids ?? []).map((id) => [id, 1]));

async function handleFlowReply(
  raw: string,
  from: string,
  profileName: string | undefined,
): Promise<void> {
  const db = serviceClient();
  let submission: FlowSubmission;

  try {
    submission = JSON.parse(raw) as FlowSubmission;
  } catch {
    await sendText(from, "Sorry — something went wrong reading that order. Please try again.");
    return;
  }

  try {
    const catalog = await loadCatalog(db);
    if (!catalog.settings.is_accepting_orders) {
      await sendText(from, catalog.settings.closed_message);
      return;
    }

    const fulfillment = submission.fulfillment === "delivery" ? "delivery" : "pickup";

    // The Flow describes one plate configuration plus a count; our cart model
    // holds each plate individually, so expand it. priceOrder caps the total.
    const plateCount = Math.min(10, Math.max(1, Number(submission.quantity) || 1));
    const plate = {
      size: requireString(submission.size, "size", 40),
      heat: requireString(submission.heat, "heat", 40),
      proteins: toQuantities(submission.proteins),
      customizations: submission.customizations ?? [],
    };

    const cart: CartInput = {
      plates: Array.from({ length: plateCount }, () => ({ ...plate })),
      extras: toQuantities(submission.extras),
      fulfillment,
    };

    const customer = {
      // WhatsApp gives us the sender's number already; the Flow asks for the
      // rest so receipts and the kitchen ticket aren't anonymous.
      name: requireString(submission.name ?? profileName, "name", 120),
      email: requireEmail(submission.email),
      phone: requirePhone(submission.phone ?? from),
    };

    const now = new Date();
    const { readyAt, scheduledFor } = resolveReadyTime(
      catalog,
      await loadExceptions(db),
      submission.when || "asap",
      now,
    );

    const delivery =
      fulfillment === "delivery"
        ? await checkDeliveryAddress(catalog, requireString(submission.address, "address", 300))
        : null;

    const { order, priced, paymentUrl } = await createPendingOrder(db, catalog, {
      cart,
      customer,
      delivery,
      readyAt,
      scheduledFor,
      note: submission.note?.slice(0, 500) ?? null,
      now,
      channel: "whatsapp",
      whatsappPhone: from,
    });

    const total = (priced.total_cents / 100).toFixed(2);
    await sendPayLink(
      from,
      `Order ${order.order_number} is held for you — $${total}.\n\n` +
        `Tap below to pay and we'll start cooking. Nothing is charged until you do.`,
      paymentUrl,
    );
  } catch (error) {
    // Validation problems are written for customers, so they can be shown.
    const message =
      error instanceof PublicError
        ? error.message
        : "Sorry — we couldn't place that order. Please try again or order at spaghettilab.store.";
    if (!(error instanceof PublicError)) console.error("whatsapp order failed", error);
    await sendText(from, message);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta's subscription handshake.
  if (req.method === "GET") {
    const verifyToken = optionalEnv("WHATSAPP_VERIFY_TOKEN");
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      verifyToken &&
      url.searchParams.get("hub.verify_token") === verifyToken
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Deployed before the Meta credentials exist, so say so plainly rather than
  // throwing an opaque 500 out of requireEnv.
  if (!optionalEnv("WHATSAPP_APP_SECRET")) {
    console.warn("whatsapp webhook called but WHATSAPP_APP_SECRET is unset");
    return new Response("WhatsApp is not configured", { status: 503 });
  }

  const rawBody = await req.text();
  if (!(await isValidSignature(rawBody, req.headers.get("x-hub-signature-256")))) {
    console.warn("rejected whatsapp webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const profileName = value.contacts?.[0]?.profile?.name;

        for (const message of value.messages ?? []) {
          const from: string = message.from;

          if (message.type === "interactive" && message.interactive?.type === "nfm_reply") {
            await handleFlowReply(
              message.interactive.nfm_reply?.response_json ?? "{}",
              from,
              profileName,
            );
          } else if (message.type === "text" || message.type === "button") {
            await sendFlowPrompt(
              from,
              "Hi! 🍝 Tap below to build your plate — pickup or delivery in Berryessa.",
            );
          }
        }
      }
    }
  } catch (error) {
    // Never ask Meta to retry: a replay would duplicate the order.
    console.error("whatsapp webhook handling failed", error);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
