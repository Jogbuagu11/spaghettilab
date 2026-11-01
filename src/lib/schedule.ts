import { CLOSE_HOUR, OPEN_HOUR, PREP_MINUTES } from "./menu";

export const TZ = "America/Los_Angeles";

/** Wall-clock parts of `now` in the kitchen's timezone. */
export function kitchenParts(now: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const get = (t: string) => Number(f.formatToParts(now).find((p) => p.type === t)?.value ?? 0);
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    minutes: get("hour") * 60 + get("minute"),
  };
}

export function isOpen(now: Date): boolean {
  const { minutes } = kitchenParts(now);
  return minutes >= OPEN_HOUR * 60 && minutes < CLOSE_HOUR * 60;
}

/** ASAP is allowed only when ready time (now + prep) still falls inside open hours. */
export function canOrderAsap(now: Date): boolean {
  const { minutes } = kitchenParts(now);
  return minutes >= OPEN_HOUR * 60 && minutes + PREP_MINUTES <= CLOSE_HOUR * 60;
}

export interface Slot {
  day: "today" | "tomorrow";
  minutes: number;
  label: string;
}

export function formatMinutes(m: number) {
  const h = Math.floor(m / 60),
    mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** 15-min slots 12:15–8:00 PM, earliest at least PREP_MINUTES from now. Falls back to tomorrow. */
export function availableSlots(now: Date): Slot[] {
  const { minutes } = kitchenParts(now);
  const all: number[] = [];
  for (let m = OPEN_HOUR * 60 + 15; m <= CLOSE_HOUR * 60; m += 15) all.push(m);
  const today = all.filter((m) => m >= minutes + PREP_MINUTES);
  const mk =
    (day: Slot["day"]) =>
    (m: number): Slot => ({
      day,
      minutes: m,
      label: `${day === "today" ? "Today" : "Tomorrow"} ${formatMinutes(m)}`,
    });
  return [...today.map(mk("today")), ...all.map(mk("tomorrow"))];
}

// ---------------------------------------------------------------------------
// Live-hours scheduling
//
// The helpers above use the build-time OPEN_HOUR/CLOSE_HOUR constants and back
// the existing tests. These take per-day hours from Supabase and produce real
// timestamps, which is what checkout sends to the server. The server validates
// the choice again against the same rows — this is only for the picker.
// ---------------------------------------------------------------------------

export interface DayHours {
  day_of_week: number;
  is_closed: boolean;
  open_minute: number;
  close_minute: number;
}

export interface TimeSlot {
  /** ISO timestamp sent to create-order. */
  iso: string;
  label: string;
}

/** Converts a kitchen wall-clock time to a real instant, DST included. */
export function kitchenTimeToDate(y: number, mo: number, d: number, minutes: number): Date {
  const naive = Date.UTC(y, mo - 1, d, 0, 0) + minutes * 60_000;
  let guess = new Date(naive);
  for (let i = 0; i < 2; i++) {
    const p = kitchenParts(guess);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, 0, 0) + p.minutes * 60_000;
    guess = new Date(naive - (asUtc - guess.getTime()));
  }
  return guess;
}

const DAY_LABEL = (offset: number) => (offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : null);

/** Bookable slots across the next `days` days, honouring per-day hours. */
export function slotsForHours(
  now: Date,
  hours: DayHours[],
  prepMinutes: number,
  intervalMinutes: number,
  days = 3,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const earliest = now.getTime() + prepMinutes * 60_000;

  for (let offset = 0; offset < days; offset++) {
    const dayStart = new Date(now.getTime() + offset * 86_400_000);
    const parts = kitchenParts(dayStart);
    const weekday = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d)).getUTCDay();

    const day = hours.find((h) => h.day_of_week === weekday);
    if (!day || day.is_closed) continue;

    for (let m = day.open_minute + intervalMinutes; m <= day.close_minute; m += intervalMinutes) {
      const at = kitchenTimeToDate(parts.y, parts.mo, parts.d, m);
      if (at.getTime() < earliest) continue;

      const prefix =
        DAY_LABEL(offset) ??
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(at);
      slots.push({ iso: at.toISOString(), label: `${prefix} ${formatMinutes(m)}` });
    }
  }

  return slots;
}

/** ASAP is offered only when the food would be ready before closing today. */
export function canOrderAsapWithHours(now: Date, hours: DayHours[], prepMinutes: number): boolean {
  const parts = kitchenParts(now);
  const weekday = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d)).getUTCDay();
  const day = hours.find((h) => h.day_of_week === weekday);
  if (!day || day.is_closed) return false;
  return parts.minutes >= day.open_minute && parts.minutes + prepMinutes <= day.close_minute;
}
