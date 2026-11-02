/**
 * Customer-initiated cancellation, authorised by the order's track token.
 *
 * Allowed right up until the order is marked delivered/completed, which is
 * what the owner asked for. Note that cancelling a cooked or out-for-delivery
 * order still refunds in full — see the `late_cancel` flag on the response if
 * you ever want to make that a judgement call instead of automatic.
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

/** Everything before the food has actually changed hands. */
const CANCELLABLE = new Set(["pending_payment", "paid", "preparing", "ready", "out_for_delivery"]);
/** Past this point the kitchen has already spent money on it. */
const ALREADY_COOKING = new Set(["preparing", "ready", "out_for_delivery"]);

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
      throw new PublicError(
        "This order has already been completed, so it can't be cancelled. " +
          "Get in touch if something was wrong with it.",
        409,
      );
    }

    // Refund before recording the cancellation, so a Square failure leaves the
    // order untouched rather than claiming a refund that never happened.
    let refunded = false;
    if (order.square_payment_id && order.paid_at) {
      await refundPayment(
        order.square_payment_id,
        order.total_cents,
        reason ?? "Cancelled by customer",
      );
      refunded = true;
    }

    const { data: updated, error } = await db
      .from("orders")
      .update({
        status: refunded ? "refunded" : "cancelled",
        cancellation_reason: reason ?? "Cancelled by customer",
      })
      .eq("id", order.id)
      .in("status", [...CANCELLABLE])
      .select("*")
      .single();

    if (error || !updated) throw error ?? new Error("cancel update failed");

    const catalog = await loadCatalog(db);
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
        email: orderCancelled(emailOrder, reason, refunded),
        template: "order_cancelled",
        orderId: order.id,
        once: true,
      }),
      // The kitchen needs to know immediately if it was already cooking.
      kitchen && ALREADY_COOKING.has(order.status)
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
      // True when the kitchen had already started: useful if you later decide
      // late cancellations shouldn't be a full automatic refund.
      late_cancel: ALREADY_COOKING.has(order.status),
    });
  } catch (error) {
    return fail(req, error);
  }
});
