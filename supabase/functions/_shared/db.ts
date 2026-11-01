import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import { requireEnv } from "./env.ts";

/**
 * Service-role client. This bypasses RLS, which is the point: all validation
 * and re-pricing happens in these functions, never in the browser.
 */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifies the caller's JWT belongs to an allowlisted admin. */
export async function requireAdmin(req: Request): Promise<string> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("unauthorized");

  const db = serviceClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user?.email) throw new Error("unauthorized");

  const email = data.user.email.toLowerCase();
  const { data: admin } = await db
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (!admin) throw new Error("unauthorized");

  return email;
}

/**
 * Guards cron-only endpoints.
 *
 * These functions are deployed with JWT verification on, so Supabase's gateway
 * has already validated the signature before we see the request — the anon key
 * is a validly signed JWT too, though, so we still have to distinguish the
 * roles. Reading the `role` claim does that without depending on the exact key
 * string Supabase happens to inject, which differs between the legacy JWT and
 * the newer `sb_secret_` key formats.
 */
export function isServiceRole(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;

  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { role?: string }).role === "service_role";
  } catch {
    return false;
  }
}
