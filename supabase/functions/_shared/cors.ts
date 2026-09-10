// CORS + JSON helpers shared by the browser-facing payment functions.
// (The webhook function is server-to-server and doesn't use these.)
//
// These endpoints are protected by the Supabase JWT (verify_jwt) and, where it
// matters, a Razorpay HMAC — not by origin — and `functions.invoke` sends no
// cookies, so we just reflect the caller's origin. A strict allowlist only
// causes silent failures (workers.dev preview URLs, www vs apex, etc.).

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/** Answer a CORS preflight; returns null for anything else. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
