import { CLOSE_HOUR, OPEN_HOUR, PREP_MINUTES } from "./menu";

export const TZ = "America/Los_Angeles";

/** Wall-clock parts of `now` in the kitchen's timezone. */
export function kitchenParts(now: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const o = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, minutes: +o.hour * 60 + +o.minute };
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

export interface Slot { day: "today" | "tomorrow"; minutes: number; label: string }

export function formatMinutes(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** 15-min slots 12:15–8:00 PM, earliest at least PREP_MINUTES from now. Falls back to tomorrow. */
export function availableSlots(now: Date): Slot[] {
  const { minutes } = kitchenParts(now);
  const all: number[] = [];
  for (let m = OPEN_HOUR * 60 + 15; m <= CLOSE_HOUR * 60; m += 15) all.push(m);
  const today = all.filter((m) => m >= minutes + PREP_MINUTES);
  const mk = (day: Slot["day"]) => (m: number): Slot => ({
    day, minutes: m, label: `${day === "today" ? "Today" : "Tomorrow"} ${formatMinutes(m)}`,
  });
  return [...today.map(mk("today")), ...all.map(mk("tomorrow"))];
}
