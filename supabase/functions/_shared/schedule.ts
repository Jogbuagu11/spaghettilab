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
