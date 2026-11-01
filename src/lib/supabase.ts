import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client. Only ever uses the anon key — RLS limits it to
 * reading the menu and published reviews. Writes and order reads go through
 * edge functions (see `src/lib/api.ts`).
 */
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && import.meta.env["DEV"]) {
  console.warn(
    "[spaghetti-lab] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset — " +
      "the site falls back to the static menu and checkout is disabled.",
  );
}

export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const functionsBaseUrl = `${url ?? ""}/functions/v1`;
