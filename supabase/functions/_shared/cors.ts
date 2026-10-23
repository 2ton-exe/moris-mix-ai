export function getCorsHeaders(allowedMethods = "GET, OPTIONS"): Record<string, string> {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const isCustomOrigin = typeof allowedOrigin === "string" && allowedOrigin.trim().length > 0;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": isCustomOrigin ? allowedOrigin.trim() : "*",
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "X-Content-Type-Options": "nosniff",
  };
  if (isCustomOrigin) {
    headers["Vary"] = "Origin";
  }
  return headers;
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "X-Content-Type-Options": "nosniff",
};

export function handleCorsPreflight(allowedMethods = "GET, OPTIONS"): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(allowedMethods),
  });
}

export function jsonResponse(
  body: unknown,
  init?: ResponseInit,
): Response {
  const headers = new Headers(getCorsHeaders());
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  if (init?.headers) {
    const customHeaders = new Headers(init.headers);
    customHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
