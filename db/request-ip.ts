type RuntimeEnv = Record<string, string | undefined>;

function runtimeEnv(): RuntimeEnv {
  return (globalThis as { process?: { env?: RuntimeEnv } }).process?.env ?? {};
}

/**
 * Returns the client IP from the header that the hosting platform itself sets.
 * Only trust a header the platform overwrites; a client can send any other header
 * to dodge per-IP rate limits. Per-IP limits are a first line only — login routes
 * also apply a per-account limit that ignores the IP entirely.
 */
export function requestIp(request: Request) {
  const env = runtimeEnv();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (env.VERCEL) return request.headers.get("x-real-ip") ?? forwardedFor ?? "unknown";
  if (env.CF_PAGES || env.CLOUDFLARE) return request.headers.get("cf-connecting-ip") ?? "unknown";
  return forwardedFor ?? request.headers.get("cf-connecting-ip") ?? "local";
}
