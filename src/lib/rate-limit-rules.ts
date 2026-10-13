// Pure rules for sign-in rate limiting; the database side lives in ./rate-limit.ts.

export const WINDOW_MINUTES = 15;

export type Limit = { key: string; max: number };

/** Per IP, and per account so many IPs together can't guess one password either. */
export function signInLimits(ip: string, email: string): Limit[] {
  return [
    { key: `ip:${ip}`, max: 10 },
    { key: `account:${email.slice(0, 200)}`, max: 50 },
  ];
}

/** Wrong setup codes, per IP (the code itself is ~79 bits, this just keeps logs quiet). */
export function setupLimits(ip: string): Limit[] {
  return [{ key: `setup-ip:${ip}`, max: 10 }];
}

/**
 * The client's address as seen by the reverse proxy (Traefik in Dokploy sets
 * X-Real-Ip and replaces client-sent forwarding headers). Falls back to a
 * shared "unknown" bucket, e.g. in local development.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const candidate = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  const ip = candidate.trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "unknown";
}

/** Limits whose count (including the attempt just recorded) is over their max. */
export function exceeded(limits: Limit[], counts: Map<string, number>): Limit[] {
  return limits.filter((limit) => (counts.get(limit.key) ?? 0) > limit.max);
}

/** Whole minutes to wait, at least one. */
export function minutesUntil(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
