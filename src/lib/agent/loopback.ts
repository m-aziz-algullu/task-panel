// Pure, so tests can import it.

export function isLoopback(address: string): boolean {
  const ip = address.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/**
 * The agent calls the API from inside the container (TASKPANEL_INTERNAL_URL), so
 * every hop must be loopback. Next.js fills x-forwarded-for with the socket's
 * address when nothing set it, and a reverse proxy (Dokploy's Traefik) adds the
 * real client, so requests from the internet are turned away before the token
 * is even looked at. Without a proxy the header can be forged; the token still
 * guards the API then.
 */
export function fromInsideContainer(request: Request): boolean {
  const hops = [request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")]
    .filter((value): value is string => value != null)
    .flatMap((value) => value.split(","))
    .filter((hop) => hop.trim() !== "");
  return hops.length > 0 && hops.every(isLoopback);
}
