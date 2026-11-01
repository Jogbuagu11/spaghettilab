import type { SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import type { BusinessHour, Catalog } from "./catalog.ts";
import { PublicError } from "./http.ts";

export const TZ = "America/Los_Angeles";

/** Wall-clock parts of an instant, as the kitchen experiences them. */
export function kitchenParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    dayOfWeek: weekdays.indexOf(get("weekday")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Offset of the kitchen's zone, in minutes, at a given instant. */
function zoneOffsetMinutes(at: Date): number {
  const p = kitchenParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0) + p.minutes * 60_000;
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Converts a kitchen wall-clock time to a UTC instant. Applied twice because
 * the first offset lookup can land on the wrong side of a DST boundary.
 */
export function kitchenTimeToUtc(year: number, month: number, day: number, minutes: number): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0) + minutes * 60_000;
  let guess = new Date(naive);
  for (let i = 0; i < 2; i++) guess = new Date(naive - zoneOffsetMinutes(guess) * 60_000);
  return guess;
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export interface DayHours {
  is_closed: boolean;
  open_minute: number;
  close_minute: number;
}

/** Hours for a given calendar day, with one-off exceptions taking precedence. */
export function hoursFor(
  hours: BusinessHour[],
  exceptions: Map<
    string,
    { is_closed: boolean; open_minute: number | null; close_minute: number | null }
  >,
  dateKey: string,
  dayOfWeek: number,
): DayHours {
  const base = hours.find((h) => h.day_of_week === dayOfWeek) ?? {
    is_closed: true,
    open_minute: 0,
    close_minute: 0,
  };
  const override = exceptions.get(dateKey);
  if (!override) return base;
  if (override.is_closed) return { is_closed: true, open_minute: 0, close_minute: 0 };
  return {
    is_closed: false,
    open_minute: override.open_minute ?? base.open_minute,
    close_minute: override.close_minute ?? base.close_minute,
  };
}

/**
 * Days since the epoch *in the kitchen's timezone*. Subtracting two of these
 * gives calendar days of notice, which is what "order a day ahead" means to a
 * customer — 7pm Monday for noon Tuesday counts, even though it's under 24h.
 */
export function kitchenDayIndex(at: Date): number {
  const p = kitchenParts(at);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/** Calendar days of notice between now and a scheduled time. ASAP is 0. */
export function leadDays(scheduledFor: Date | null, now: Date): number {
  if (!scheduledFor) return 0;
  return Math.max(0, kitchenDayIndex(scheduledFor) - kitchenDayIndex(now));
}

export interface ResolvedTime {
  readyAt: Date;
  scheduledFor: Date | null;
}

/** How far ahead a customer may schedule. */
const MAX_DAYS_AHEAD = 7;

/**
 * Validates the requested fulfilment time and returns when the order will be
 * ready. `when` is either "asap" or an ISO timestamp from the slot picker.
 */
export function resolveReadyTime(
  catalog: Catalog,
  exceptions: Map<
    string,
    { is_closed: boolean; open_minute: number | null; close_minute: number | null }
  >,
  when: string,
  now: Date,
): ResolvedTime {
  const { prep_minutes, slot_interval_minutes } = catalog.settings;

  if (when === "asap") {
    const p = kitchenParts(now);
    const today = hoursFor(catalog.hours, exceptions, p.dateKey, p.dayOfWeek);
    if (
      today.is_closed ||
      p.minutes < today.open_minute ||
      p.minutes + prep_minutes > today.close_minute
    ) {
      throw new PublicError("We're closed right now — please pick a scheduled time instead.");
    }
    return { readyAt: new Date(now.getTime() + prep_minutes * 60_000), scheduledFor: null };
  }

  const requested = new Date(when);
  if (Number.isNaN(requested.getTime())) throw new PublicError("That pickup time isn't valid.");

  if (requested.getTime() < now.getTime() + prep_minutes * 60_000 - 60_000) {
    throw new PublicError(`We need at least ${prep_minutes} minutes — please pick a later time.`);
  }
  if (requested.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
    throw new PublicError(`You can schedule up to ${MAX_DAYS_AHEAD} days ahead.`);
  }

  const p = kitchenParts(requested);
  if (p.minutes % slot_interval_minutes !== 0) {
    throw new PublicError("That pickup time isn't one of our slots.");
  }

  const day = hoursFor(catalog.hours, exceptions, p.dateKey, p.dayOfWeek);
  if (day.is_closed) throw new PublicError("We're closed that day — please pick another time.");
  if (p.minutes < day.open_minute + slot_interval_minutes || p.minutes > day.close_minute) {
    throw new PublicError(
      `That time is outside our hours (${formatMinutes(day.open_minute)}–${formatMinutes(day.close_minute)}).`,
    );
  }

  return { readyAt: requested, scheduledFor: requested };
}

export function formatReadyAt(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export type ScheduleExceptions = Map<
  string,
  { is_closed: boolean; open_minute: number | null; close_minute: number | null }
>;

/** One-off closures and shortened days, keyed by the yyyy-mm-dd kitchen date. */
export async function loadExceptions(db: SupabaseClient): Promise<ScheduleExceptions> {
  const { data } = await db
    .from("schedule_exceptions")
    .select("exception_date, is_closed, open_minute, close_minute");

  return new Map(
    (data ?? []).map((row) => [
      row.exception_date as string,
      {
        is_closed: row.is_closed as boolean,
        open_minute: row.open_minute as number | null,
        close_minute: row.close_minute as number | null,
      },
    ]),
  );
}

/** yyyy-mm-dd for a kitchen-local date, the form the date columns store. */
export function kitchenDateKey(at: Date): string {
  const p = kitchenParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The next kitchen date falling on `dayOfWeek` that is at least `minLeadDays`
 * away — used to pick when a weekly standing order first runs, and to advance
 * it afterwards. Returns a yyyy-mm-dd key.
 */
export function nextWeeklyDate(dayOfWeek: number, from: Date, minLeadDays = 1): string {
  const start = kitchenParts(from);
  // Walk forward a day at a time; cheap, and sidesteps DST arithmetic entirely.
  for (let offset = minLeadDays; offset <= minLeadDays + 7; offset++) {
    const candidate = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12));
    const parts = kitchenParts(candidate);
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    if (weekday === dayOfWeek) {
      return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    }
  }
  throw new Error("could not find a weekly date");
}

/** Turns a stored yyyy-mm-dd + minute-of-day into a real instant. */
export function dateKeyToInstant(dateKey: string, minute: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return kitchenTimeToUtc(y!, m!, d!, minute);
}
