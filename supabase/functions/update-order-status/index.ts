/**
 * Admin status transitions, with the matching customer email.
 *
 * Cancelling a paid order refunds it through Square first — if the refund
 * fails the status is left alone, so the dashboard can never claim a customer
 * was refunded when they weren't.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { requireAdmin, serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import {
  orderCancelled,
  orderDelivered,
  orderStatus,
  type EmailOrder,
} from "../_shared/emails/templates.ts";
import { requireEnv } from "../_shared/env.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { refundPayment } from "../_shared/square.ts";
import { optionalString } from "../_shared/validate.ts";

type Status =
  "paid" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled" | "refunded";

/** Legal transitions. Anything else is a bug or a stale dashboard tab. */
const ALLOWED: Record<string, Status[]> = {
  paid: ["preparing", "ready", "cancelled", "refunded"],
  preparing: ["ready", "out_for_delivery", "cancelled", "refunded"],
  ready: ["out_for_delivery", "completed", "cancelled", "refunded"],
  out_for_delivery: ["completed", "cancelled", "refunded"],
  completed: ["refunded"],
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = serviceClient();

  try {
    try {
      await requireAdmin(req);
    } catch {
      throw new PublicError("Not authorised.", 401);
    }

    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });

    const orderId = String(payload.orderId ?? "");
    const deliveryNote = optionalString(payload.deliveryNote, 200);
    const photoPath = optionalString(payload.photoPath, 300);
    const next = String(payload.status ?? "") as Status;
    const reason = optionalString(payload.reason, 300);

    const { data: order } = await db
      .from("orders")
      .select(
        "*, order_items (label, quantity, unit_price_cents, total_price_cents, config, sort_order)",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!order) throw new PublicError("Order not found.", 404);

    // The admin uploads straight to storage, then hands us the path. Pin it to
    // this order so a mistyped or malicious path can't attach someone else's
    // photo to a different customer's receipt.
    let photoUrl: string | null = null;
    if (photoPath) {
      if (!/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,}\.(jpg|jpeg|png|webp)$/i.test(photoPath)) {
        throw new PublicError("That photo path isn't valid.");
      }
      if (!photoPath.startsWith(`${orderId}/`)) {
        throw new PublicError("That photo belongs to a different order.");
      }
      photoUrl = `${requireEnv("SUPABASE_URL")}/storage/v1/object/public/delivery-proof/${photoPath}`;
    }

    const legal = ALLOWED[order.status] ?? [];
    if (!legal.includes(next)) {
      throw new PublicError(`Can't move an order from ${order.status} to ${next}.`, 409);
    }

    // Refund before recording it, so a Square failure aborts the transition.
    let refunded = false;
    if ((next === "refunded" || next === "cancelled") && order.square_payment_id && order.paid_at) {
      if (next === "refunded" || payload.refund === true) {
        await refundPayment(
          order.square_payment_id,
          order.total_cents,
          reason ?? "Order cancelled",
        );
        refunded = true;
      }
    }

    const { data: updated, error } = await db
      .from("orders")
      .update({
        status: next,
        cancellation_reason: next === "cancelled" || next === "refunded" ? reason : null,
        completed_at: next === "completed" ? new Date().toISOString() : order.completed_at,
        ...(photoPath ? { delivery_photo_path: photoPath, delivery_photo_url: photoUrl } : {}),
        ...(deliveryNote ? { delivery_note: deliveryNote } : {}),
      })
      .eq("id", orderId)
      .select("*")
      .single();
    if (error) throw error;

    const catalog = await loadCatalog(db);
    const ctx = {
      pickupAddress: catalog.settings.pickup_address,
      contactPhone: catalog.settings.contact_phone,
      googleReviewUrl: catalog.settings.google_review_url,
    };
    const emailOrder: EmailOrder = {
      ...updated,
      items: [...((order.order_items ?? []) as { sort_order: number }[])].sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    };

    // A completed delivery gets its own email: it says *delivered*, names the
    // drop-off spot and carries the photo. Pickup keeps the generic copy.
    const isDelivery = updated.fulfillment === "delivery";
    const email =
      next === "cancelled" || next === "refunded"
        ? orderCancelled(emailOrder, reason, refunded)
        : next === "completed" && isDelivery
          ? orderDelivered(emailOrder, ctx)
          : orderStatus(emailOrder, ctx, next);

    if (email) {
      await sendEmail(db, {
        to: updated.customer_email,
        email,
        template: next === "completed" && isDelivery ? "order_delivered" : `order_${next}`,
        orderId,
        once: true,
      });
    }

    return json(req, { ok: true, status: next, refunded, photoUrl });
  } catch (error) {
    return fail(req, error);
  }
});
