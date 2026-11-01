import { PublicError } from "./http.ts";

export function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PublicError(`Please enter your ${field}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new PublicError(`That ${field} is too long.`);
  return trimmed;
}

export function optionalString(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireEmail(value: unknown): string {
  const email = requireString(value, "email address", 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new PublicError("That email address doesn't look right.");
  return email;
}

/**
 * Normalises to E.164 for US numbers so the kitchen can tap-to-call and so
 * duplicate-order checks match consistently.
 */
export function requirePhone(value: unknown): string {
  const raw = requireString(value, "phone number", 32);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new PublicError("That phone number doesn't look right — use a 10-digit US number.");
}
