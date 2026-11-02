/**
 * Customer-initiated cancellation, authorised by the order's track token.
 *
 *   pending_payment / paid  cancel, refunded in full
 *   preparing / ready       cancel, minus a fee — the food already exists
 *   out_for_delivery        refused, it's in the car
 *   completed               refused
 *
 * The fee is a share of the food subtotal only. Delivery and tip come back in
 * full, because neither was rendered; billing for a trip that never happened
 * is the kind of thing that loses a chargeback.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { orderCancelled, type EmailOrder } from "../_shared/emails/templates.ts";
import { optionalEnv } from "../_shared/env.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { refundPayment } from "../_shared/square.ts";
import { optionalString } from "../_shared/validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CANCELLABLE = new Set(["pending_payment", "paid", "preparing", "ready"]);
/** Cancellable, but the food is already made. */
const CHARGEABLE = new Set(["preparing", "ready"]);

/** Why a cancellation was refused, in words a customer can act on. */
const REFUSAL: Record<string, string> = {
  out_for_delivery:
    "This order is already on its way, so it can't be cancelled now. " +
    "Please call us if something's wrong.",
  completed:
    "This order has already been completed, so it can't be cancelled. " +
    "Get in touch if something was wrong with it.",
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = serviceClient();

  try {
    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });

    const token = String(payload.token ?? "");
    if (!UUID_RE.test(token)) throw new PublicError("That tracking link isn't valid.", 404);
    const reason = optionalString(payload.reason, 200);

    const { data: order } = await db
      .from("orders")
      .select(
        "*, order_items (label, quantity, unit_price_cents, total_price_cents, config, sort_order)",
      )
      .eq("track_token", token)
      .maybeSingle();

    if (!order) throw new PublicError("We couldn't find that order.", 404);

    if (order.status === "cancelled" || order.status === "refunded") {
      return json(req, { ok: true, status: order.status, refunded: false, alreadyCancelled: true });
    }
    if (!CANCELLABLE.has(order.status)) {
      throw new PublicError(REFUSAL[order.status] ?? "This order can no longer be cancelled.", 409);
    }

    const catalog = await loadCatalog(db);
    // Charged on the food only: delivery and tip are returned whole.
    const feeCents = CHARGEABLE.has(order.status)
      ? Math.round((order.subtotal_cents * catalog.settings.late_cancel_fee_percent) / 100)
      : 0;
    const refundCents = Math.max(0, order.total_cents - feeCents);

    // Refund before recording the cancellation, so a Square failure leaves the
    // order untouched rather than claiming a refund that never happened.
    let refunded = false;
    if (order.square_payment_id && order.paid_at && refundCents > 0) {
      await refundPayment(order.square_payment_id, refundCents, reason ?? "Cancelled by customer");
      refunded = true;
    }

    const { data: updated, error } = await db
      .from("orders")
      .update({
        status: refunded ? "refunded" : "cancelled",
        cancellation_reason: reason ?? "Cancelled by customer",
        cancellation_fee_cents: feeCents,
      })
      .eq("id", order.id)
      .in("status", [...CANCELLABLE])
      .select("*")
      .single();

    if (error || !updated) throw error ?? new Error("cancel update failed");

    const emailOrder: EmailOrder = {
      ...updated,
      items: [...(order.order_items ?? [])].sort(
        (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
      ),
    };

    const kitchen = optionalEnv("KITCHEN_EMAIL");
    await Promise.allSettled([
      sendEmail(db, {
        to: updated.customer_email,
        email: orderCancelled(emailOrder, reason, refunded, feeCents, {
          pickupAddress: catalog.settings.pickup_address,
          contactPhone: catalog.settings.contact_phone,
          contactEmail: catalog.settings.contact_email,
          googleReviewUrl: catalog.settings.google_review_url,
        }),
        template: "order_cancelled",
        orderId: order.id,
        once: true,
      }),
      // The kitchen needs to know immediately if it was already cooking.
      kitchen && CHARGEABLE.has(order.status)
        ? sendEmail(db, {
            to: kitchen,
            email: {
              subject: `⚠ ${updated.order_number} cancelled while ${order.status.replace(/_/g, " ")}`,
              html: orderCancelled(emailOrder, reason, refunded).html,
            },
            template: "kitchen_cancel_alert",
            orderId: order.id,
            once: true,
          })
        : Promise.resolve(false),
    ]);

    return json(req, {
      ok: true,
      status: updated.status,
      refunded,
      feeCents,
      refundCents,
      lateCancel: CHARGEABLE.has(order.status),
    });
  } catch (error) {
    return fail(req, error);
  }
});
