/**
 * Self-service for a weekly standing order, reached from the link in every
 * subscription email. The 128-bit manage_token is the credential — guest
 * checkout means there's no account to log into.
 *
 * Cancelling is deliberately one request with no confirmation step on the
 * server: recurring charges should always be trivially easy to stop.
 */
import { serviceClient } from "../_shared/db.ts";
import { sendEmail } from "../_shared/emails/send.ts";
import { subscriptionCancelled, type EmailSubscription } from "../_shared/emails/templates.ts";
import { fail, json, preflight, PublicError } from "../_shared/http.ts";
import { nextWeeklyDate } from "../_shared/schedule.ts";
import { forgetCard } from "../_shared/square.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUBLIC_FIELDS = `id, reference, status, customer_name, fulfillment, delivery_address, day_of_week,
   ready_minute, plates, extras, tip_percent, card_brand, card_last4, manage_token,
   next_run_date, last_charged_at, created_at`;

async function load(db: ReturnType<typeof serviceClient>, token: string) {
  if (!UUID_RE.test(token)) throw new PublicError("That link isn't valid.", 404);
  const { data } = await db
    .from("subscriptions")
    .select(PUBLIC_FIELDS)
    .eq("manage_token", token)
    .maybeSingle();
  if (!data) throw new PublicError("We couldn't find that standing order.", 404);
  return data;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = serviceClient();

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token") ?? "";
      const subscription = await load(db, token);

      const { data: skips } = await db
        .from("subscription_skips")
        .select("skip_date")
        .eq("subscription_id", subscription.id)
        .gte("skip_date", new Date().toISOString().slice(0, 10));

      return json(req, {
        subscription,
        skippedDates: (skips ?? []).map((s) => s.skip_date),
      });
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

    const payload = await req.json().catch(() => {
      throw new PublicError("Malformed request.");
    });
    const subscription = await load(db, String(payload.token ?? ""));
    const action = String(payload.action ?? "");

    if (subscription.status === "cancelled" && action !== "status") {
      throw new PublicError("This standing order has already been cancelled.", 409);
    }

    switch (action) {
      case "skip_next": {
        await db
          .from("subscription_skips")
          .upsert(
            { subscription_id: subscription.id, skip_date: subscription.next_run_date },
            { onConflict: "subscription_id,skip_date" },
          );
        // Move the pointer on so the sweep doesn't have to reason about skips.
        const after = nextWeeklyDate(
          subscription.day_of_week,
          new Date(`${subscription.next_run_date}T12:00:00Z`),
          1,
        );
        await db.from("subscriptions").update({ next_run_date: after }).eq("id", subscription.id);
        return json(req, { ok: true, status: subscription.status, nextRunDate: after });
      }

      case "pause": {
        await db.from("subscriptions").update({ status: "paused" }).eq("id", subscription.id);
        return json(req, { ok: true, status: "paused" });
      }

      case "resume": {
        const next = nextWeeklyDate(subscription.day_of_week, new Date(), 1);
        await db
          .from("subscriptions")
          .update({ status: "active", next_run_date: next, failure_count: 0, last_error: null })
          .eq("id", subscription.id);
        return json(req, { ok: true, status: "active", nextRunDate: next });
      }

      case "cancel": {
        const { data: full } = await db
          .from("subscriptions")
          .select("square_card_id")
          .eq("id", subscription.id)
          .single();

        await db
          .from("subscriptions")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", subscription.id);

        // Stop holding the card once it can't be used again.
        if (full?.square_card_id) await forgetCard(full.square_card_id);

        await sendEmail(db, {
          to:
            (
              await db
                .from("subscriptions")
                .select("customer_email")
                .eq("id", subscription.id)
                .single()
            ).data?.customer_email ?? "",
          email: subscriptionCancelled(subscription as unknown as EmailSubscription),
          template: "subscription_cancelled",
        });

        return json(req, { ok: true, status: "cancelled" });
      }

      default:
        throw new PublicError("Unknown action.");
    }
  } catch (error) {
    return fail(req, error);
  }
});
