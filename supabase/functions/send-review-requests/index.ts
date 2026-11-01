/**
 * Review-request sweep. Intended to run on a schedule (pg_cron, see
 * supabase/migrations/..._cron.sql) rather than being called by the browser.
 *
 * Emails customers a few hours after their order completes — long enough that
 * they've eaten, soon enough that they remember.
 */
import { loadCatalog } from "../_shared/catalog.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { reviewRequest, type EmailOrder } from "../_shared/emails/templates.ts";
import { requireEnv } from "../_shared/env.ts";

const DELAY_HOURS = 3;
const WINDOW_HOURS = 72; // don't chase orders older than this
const BATCH = 50;

Deno.serve(async (req) => {
  // Invoked by cron with the service role key, never from a browser.
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (auth !== requireEnv("SUPABASE_SERVICE_ROLE_KEY")) {
    return new Response("Not authorised", { status: 401 });
  }

  const db = serviceClient();
  const now = Date.now();

  const { data: orders, error } = await db
    .from("orders")
    .select(
      "*, order_items (label, quantity, unit_price_cents, total_price_cents, config, sort_order)",
    )
    .eq("status", "completed")
    .lte("completed_at", new Date(now - DELAY_HOURS * 3_600_000).toISOString())
    .gte("completed_at", new Date(now - WINDOW_HOURS * 3_600_000).toISOString())
    .limit(BATCH);

  if (error) {
    console.error(error);
    return new Response("Query failed", { status: 500 });
  }

  const catalog = await loadCatalog(db);
  const ctx = {
    pickupAddress: catalog.settings.pickup_address,
    contactPhone: catalog.settings.contact_phone,
    googleReviewUrl: catalog.settings.google_review_url,
  };

  let sent = 0;
  for (const order of orders ?? []) {
    const emailOrder: EmailOrder = { ...order, items: order.order_items ?? [] };
    // `once` makes the whole sweep idempotent — re-running sends nothing twice.
    const did = await sendEmail(db, {
      to: order.customer_email,
      email: reviewRequest(emailOrder, ctx),
      template: "review_request",
      orderId: order.id,
      once: true,
    });
    if (did) sent++;
  }

  return new Response(JSON.stringify({ considered: orders?.length ?? 0, sent }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
