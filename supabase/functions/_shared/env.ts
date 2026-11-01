/** Typed access to secrets, with a loud failure instead of a silent `undefined`. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const optionalEnv = (name: string) => Deno.env.get(name) ?? "";

/** Square's sandbox and production hosts differ; everything else is identical. */
export function squareApiBase(): string {
  return (Deno.env.get("SQUARE_ENVIRONMENT") ?? "sandbox") === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export const SITE_URL = Deno.env.get("SITE_URL") ?? "https://spaghettilab.store";
export const FROM_EMAIL =
  Deno.env.get("RESEND_FROM") ?? "Spaghetti Lab <no-reply@spaghettilab.store>";
export const REPLY_TO = Deno.env.get("RESEND_REPLY_TO") ?? "hello@spaghettilab.store";
