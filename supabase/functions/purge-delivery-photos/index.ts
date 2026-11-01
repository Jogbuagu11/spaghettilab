/**
 * Deletes delivery photos older than the retention window.
 *
 * These are pictures of customers' doorsteps, so they're kept only as long as
 * a delivery dispute could plausibly arrive — not indefinitely. Runs daily
 * from cron (see supabase/cron-jobs.sql).
 *
 * Note the object is removed at origin immediately, but a public-bucket URL
 * can still be served from Supabase's CDN cache for up to its cache-control
 * lifetime (one hour by default). Deletion is therefore prompt, not instant,
 * for anyone already holding the exact URL.
 */
import { isServiceRole, serviceClient } from "../_shared/db.ts";

const RETENTION_DAYS = 30;
const BATCH = 200;
const BUCKET = "delivery-proof";

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("Not authorised", { status: 401 });

  const db = serviceClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();

  const { data: expired, error } = await db
    .from("orders")
    .select("id, delivery_photo_path")
    .not("delivery_photo_path", "is", null)
    .lt("completed_at", cutoff)
    .limit(BATCH);

  if (error) {
    console.error(error);
    return new Response("Query failed", { status: 500 });
  }

  const rows = expired ?? [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ expired: 0, deleted: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const paths = rows.map((r) => r.delivery_photo_path as string);
  const { error: removeError } = await db.storage.from(BUCKET).remove(paths);

  // Clear the columns even if storage removal partially failed — a dangling
  // object is recoverable, but a URL pointing at a deleted file in a customer's
  // receipt is just a broken image.
  if (removeError) console.error("storage removal failed", removeError);

  const { error: updateError } = await db
    .from("orders")
    .update({ delivery_photo_path: null, delivery_photo_url: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );

  if (updateError) {
    console.error(updateError);
    return new Response("Update failed", { status: 500 });
  }

  return new Response(
    JSON.stringify({ expired: rows.length, deleted: removeError ? 0 : paths.length }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
