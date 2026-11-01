/**
 * Review submission from the link in the review-request email.
 *
 * The track_token proves the reviewer actually ordered, which is what makes
 * these "verified" reviews. Submissions start unpublished and are moderated
 * in the admin dashboard before they can appear in AggregateRating markup.
 */
import { serviceClient } from "../_shared/db.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { optionalString } from "../_shared/validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });

    const token = String(payload.token ?? "");
    if (!UUID_RE.test(token)) throw new PublicError("That review link isn't valid.", 404);

    const rating = Number(payload.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new PublicError("Please choose a rating from 1 to 5 stars.");
    }

    const db = serviceClient();
    const { data: order } = await db
      .from("orders")
      .select("id, customer_name, status")
      .eq("track_token", token)
      .maybeSingle();

    if (!order) throw new PublicError("We couldn't find that order.", 404);
    if (!["completed", "ready", "out_for_delivery"].includes(order.status)) {
      throw new PublicError("You can leave a review once your order is on its way.", 409);
    }

    // Show a first name only — reviews render publicly.
    const authorName = order.customer_name.trim().split(/\s+/)[0] || "Guest";

    const { error } = await db.from("reviews").upsert(
      {
        order_id: order.id,
        rating,
        body: optionalString(payload.body, 1500),
        author_name: authorName,
        is_published: false,
      },
      { onConflict: "order_id" },
    );
    if (error) throw error;

    return json(req, { ok: true });
  } catch (error) {
    return fail(req, error);
  }
});
