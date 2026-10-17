/**
 * The client address that Cloudflare sets. A client sets `X-Forwarded-For` itself, so a rate limit
 * never reads it. A request with no Cloudflare address, as in local development, shares one key.
 */
export function requestSourceIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "127.0.0.1";
}
