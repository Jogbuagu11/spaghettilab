import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
