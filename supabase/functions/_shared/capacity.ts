import type { SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import type { Catalog } from "./catalog.ts";
import { PublicError } from "./http.ts";
import { formatReadyAt } from "./schedule.ts";

/**
 * Deliveries are capped per clock hour; pickup is not.
 *
 * Every delivery costs a round trip, so three in an hour already consumes most
 * of it. Plates for collection come off the same stove whether one person or
 * ten turn up, so capping pickup would turn away business for no reason.
 */
export async function assertDeliveryCapacity(
  db: SupabaseClient,
  catalog: Catalog,
  readyAt: Date,
): Promise<void> {
  const limit = catalog.settings.delivery_per_hour_limit;
  if (limit <= 0) {
    throw new PublicError("We're not delivering right now — pickup is still available.");
  }

  const hourStart = new Date(readyAt);
  hourStart.setMinutes(0, 0, 0);
  const hourEnd = new Date(hourStart.getTime() + 3_600_000);

  const { count, error } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("fulfillment", "delivery")
    .in("status", ["pending_payment", "paid", "preparing", "ready", "out_for_delivery"])
    .gte("ready_at", hourStart.toISOString())
    .lt("ready_at", hourEnd.toISOString());

  if (error) throw error;
  if ((count ?? 0) < limit) return;

  throw new PublicError(
    `We're fully booked for delivery around ${formatReadyAt(hourStart)}. ` +
      `Please choose a later time, or switch to pickup — pickup is always available.`,
  );
}

/**
 * ASAP orders quote a longer wait as the queue grows rather than being
 * refused: a busy evening should slow down, not close.
 */
export async function effectivePrepMinutes(db: SupabaseClient, catalog: Catalog): Promise<number> {
  const { prep_minutes, queue_minutes_per_order, max_prep_minutes } = catalog.settings;
  if (queue_minutes_per_order <= 0) return prep_minutes;

  const { count, error } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ["paid", "preparing"]);

  // A failure here shouldn't block checkout; fall back to the base estimate.
  if (error) {
    console.error("queue depth lookup failed", error);
    return prep_minutes;
  }

  return Math.min(max_prep_minutes, prep_minutes + (count ?? 0) * queue_minutes_per_order);
}
