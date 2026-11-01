import { SITE_URL } from "./env.ts";

// Only the storefront and local dev may call these functions from a browser.
const ALLOWED = new Set([
  SITE_URL,
  "https://spaghettilab.store",
  "https://www.spaghettilab.store",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED.has(origin) ? origin : SITE_URL;
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export const preflight = (req: Request) =>
  req.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) })
    : null;

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req.headers.get("origin")), "content-type": "application/json" },
  });
}

/**
 * Errors reaching the browser are deliberately vague unless explicitly marked
 * public — an internal message can leak schema or key details.
 */
export class PublicError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function fail(req: Request, error: unknown): Response {
  if (error instanceof PublicError) {
    return json(req, { error: error.message }, error.status);
  }
  console.error("unhandled", error);
  return json(req, { error: "Something went wrong on our end. Please try again." }, 500);
}
