/**
 * Places and charges a one-off order.
 *
 * The browser sends only *what* it wants — never prices. The time slot is
 * resolved first (free delivery depends on how far ahead the order is), then
 * placeAndChargeOrder re-prices the cart from the database, writes the order
 * and charges the Square token.
 */
import { loadCatalog, type CartInput } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { checkDeliveryAddress } from "../_shared/delivery.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { placeAndChargeOrder, type DeliveryDetails } from "../_shared/place-order.ts";
import { loadExceptions, resolveReadyTime } from "../_shared/schedule.ts";
import { optionalString, requireEmail, requirePhone, requireString } from "../_shared/validate.ts";

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
    const note = optionalString(payload.note, 500);

    const fulfillment = payload.fulfillment === "delivery" ? "delivery" : "pickup";
    const cart: CartInput = {
      plates: payload.plates,
      extras: payload.extras ?? {},
      fulfillment,
    };

    const catalog = await loadCatalog(db);
    if (!catalog.settings.is_accepting_orders) {
      throw new PublicError(catalog.settings.closed_message, 409);
    }

    const now = new Date();
    const { readyAt, scheduledFor } = resolveReadyTime(
      catalog,
      await loadExceptions(db),
      typeof payload.when === "string" ? payload.when : "asap",
      now,
    );

    let delivery: DeliveryDetails | null = null;
    if (fulfillment === "delivery") {
      delivery = await checkDeliveryAddress(
        catalog,
        requireString(payload.deliveryAddress, "delivery address", 300),
      );
    }

    const placed = await placeAndChargeOrder(db, catalog, {
      cart,
      customer,
      delivery,
      readyAt,
      scheduledFor,
      tipCents: Number(payload.tipCents ?? 0),
      note,
      now,
      payment: {
        sourceId,
        verificationToken:
          typeof payload.verificationToken === "string" ? payload.verificationToken : undefined,
      },
    });

    return json(req, {
      orderNumber: placed.order.order_number,
      trackToken: placed.order.track_token,
      status: placed.paid ? "paid" : "pending_payment",
      receiptUrl: placed.charge.receiptUrl ?? null,
      totalCents: placed.priced.total_cents,
      freeDelivery: placed.priced.free_delivery,
    });
  } catch (error) {
    return fail(req, error);
  }
});
