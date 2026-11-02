/**
 * Pushes an order's ready time back and tells the customer.
 *
 * Kept separate from update-order-status because a delay isn't a state
 * transition — the order stays exactly where it is in the workflow, only its
 * promised time moves. Conflating the two would mean inventing a "delayed"
 * status that every transition table then has to account for.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { requireAdmin, serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { orderDelayed, type EmailOrder } from "../_shared/emails/templates.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { optionalString } from "../_shared/validate.ts";

/** Statuses where a delay still means something to the customer. */
const DELAYABLE = new Set(["paid", "preparing", "ready", "out_for_delivery"]);

const MAX_SINGLE_DELAY = 180;

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
    const minutes = Number(payload.minutes);
    const reason = optionalString(payload.reason, 200);
    const notify = payload.notify !== false;

    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_SINGLE_DELAY) {
      throw new PublicError(`Choose a delay between 1 and ${MAX_SINGLE_DELAY} minutes.`);
    }

    const { data: order } = await db
      .from("orders")
      .select(
        "*, order_items (label, quantity, unit_price_cents, total_price_cents, config, sort_order)",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!order) throw new PublicError("Order not found.", 404);
    if (!DELAYABLE.has(order.status)) {
      throw new PublicError(`A ${order.status.replace(/_/g, " ")} order can't be delayed.`, 409);
    }
    if (!order.ready_at) throw new PublicError("That order has no ready time to move.");

    const newReadyAt = new Date(new Date(order.ready_at).getTime() + minutes * 60_000);

    const { data: updated, error } = await db
      .from("orders")
      .update({
        ready_at: newReadyAt.toISOString(),
        // Captured once, so repeated delays still show what was first promised.
        original_ready_at: order.original_ready_at ?? order.ready_at,
        delay_minutes: (order.delay_minutes ?? 0) + minutes,
        delay_count: (order.delay_count ?? 0) + 1,
        // Keep the previous explanation unless a new one is typed — a second
        // bump is usually the same cause, and blanking it would strip context
        // from the customer's tracking page.
        delay_reason: reason ?? order.delay_reason,
      })
      .eq("id", orderId)
      .select("*")
      .single();

    if (error || !updated) throw error ?? new Error("delay update failed");

    let emailed = false;
    if (notify) {
      const catalog = await loadCatalog(db);
      const emailOrder: EmailOrder = {
        ...updated,
        items: [...(order.order_items ?? [])].sort(
          (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
        ),
      };

      emailed = await sendEmail(db, {
        to: updated.customer_email,
        email: orderDelayed(emailOrder, {
          pickupAddress: catalog.settings.pickup_address,
          contactPhone: catalog.settings.contact_phone,
          googleReviewUrl: catalog.settings.google_review_url,
        }),
        // Keyed by delay number so a second delay isn't swallowed by the
        // once-per-template guard that protects receipts from duplicates.
        template: `order_delayed_${updated.delay_count}`,
        orderId,
        once: true,
      });
    }

    return json(req, {
      ok: true,
      readyAt: updated.ready_at,
      delayMinutes: updated.delay_minutes,
      delayCount: updated.delay_count,
      emailed,
    });
  } catch (error) {
    return fail(req, error);
  }
});
