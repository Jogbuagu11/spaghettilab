/**
 * Public order lookup for /track.
 *
 * Guest checkout means there's no session to authorise against, so the order's
 * 128-bit track_token is the credential. Only fields the customer should see
 * are returned — never internal notes, Square ids or other customers' data.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses where the customer has paid and may see the pickup address. */
const ADDRESS_VISIBLE = new Set(["paid", "preparing", "ready", "out_for_delivery", "completed"]);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!UUID_RE.test(token)) throw new PublicError("That tracking link isn't valid.", 404);

    const db = serviceClient();
    const { data: order, error } = await db
      .from("orders")
      .select(
        `id, order_number, status, fulfillment, customer_name, delivery_address,
         scheduled_for, ready_at, subtotal_cents, delivery_fee_cents, tax_cents,
         tip_cents, total_cents, square_receipt_url, card_brand, card_last4,
         customer_note, created_at, completed_at,
         order_items (label, quantity, unit_price_cents, total_price_cents, config, sort_order)`,
      )
      .eq("track_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!order) throw new PublicError("We couldn't find that order.", 404);

    const catalog = await loadCatalog(db);
    const { order_items, ...rest } = order as typeof order & {
      order_items: { sort_order: number }[] | null;
    };

    return json(req, {
      order: {
        ...rest,
        items: [...(order_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      },
      pickupAddress:
        order.fulfillment === "pickup" && ADDRESS_VISIBLE.has(order.status)
          ? catalog.settings.pickup_address
          : null,
      contactPhone: catalog.settings.contact_phone,
      reviewUrl: catalog.settings.google_review_url,
    });
  } catch (error) {
    return fail(req, error);
  }
});
