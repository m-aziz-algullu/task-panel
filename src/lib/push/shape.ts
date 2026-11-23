// Web Push: what the server, the settings page and the tests share. Pure, so it
// is safe in Client Components (no "server-only", no Node APIs).

import { z } from "zod";

/** What the service worker gets (encrypted) and shows as a notification. */
export type PushPayload = {
  title: string;
  body: string;
  /** Same-origin path opened when the notification is clicked. */
  url: string;
  /** A newer notification with the same tag replaces the older one on the device. */
  tag: string;
};

/** A notification is dropped if it can't be delivered within a day: by then it's old news. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Tries per notification and device before it is given up. */
export const MAX_PUSH_ATTEMPTS = 8;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60 * 1000;

/** The URL-safe base64 the Push API uses (RFC 4648 §5, no padding) as bytes; null if malformed. */
export function base64UrlBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return null;
  const plain = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (plain.length % 4 === 1) return null;
  try {
    const binary = atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Bytes as URL-safe base64 without padding, the way the server stores keys. */
export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const base64UrlKey = (length: number, check: (bytes: Uint8Array) => boolean = () => true) =>
  z
    .string()
    .max(200)
    .refine((value) => {
      const bytes = base64UrlBytes(value);
      return bytes != null && bytes.length === length && check(bytes);
    });

/**
 * PushSubscription.toJSON() from the browser. Only https endpoints: every push
 * service is one, and the server is about to send requests to this URL.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    // An uncompressed P-256 point: 0x04, then x and y.
    p256dh: base64UrlKey(65, (bytes) => bytes[0] === 0x04),
    auth: base64UrlKey(16),
  }),
});

export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>;

/** The server's VAPID public key, as given to pushManager.subscribe(). */
export const vapidPublicKeySchema = base64UrlKey(65, (bytes) => bytes[0] === 0x04);

/** What the push service's answer means for one delivery. */
export type PushOutcome =
  | { kind: "delivered" }
  /** The subscription is gone for good (unsubscribed, expired): forget it. */
  | { kind: "gone"; error: string }
  /** A temporary failure: try again later, no sooner than `retryAfterMs` if the service said so. */
  | { kind: "retry"; error: string; retryAfterMs?: number }
  /** Refused, and sending the same thing again won't change that (bad payload, bad VAPID…). */
  | { kind: "rejected"; error: string };

/** Retry-After: seconds or an HTTP date (RFC 9110 §10.2.3), in milliseconds from `now`. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * How to treat the push service's HTTP status (RFC 8030 plus what FCM, Mozilla
 * autopush and Apple actually return).
 */
export function classifyPushResponse(
  status: number,
  detail: string,
  retryAfter?: string | null,
  now = Date.now(),
): PushOutcome {
  if (status >= 200 && status < 300) return { kind: "delivered" };
  const error = `HTTP ${status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
  // 404 Not Found / 410 Gone: the subscription expired or the user unsubscribed.
  if (status === 404 || status === 410) return { kind: "gone", error };
  // Throttled, timed out or a server-side failure: worth another try.
  if (status === 408 || status === 429 || status >= 500) {
    const retryAfterMs = parseRetryAfter(retryAfter, now);
    return retryAfterMs == null ? { kind: "retry", error } : { kind: "retry", error, retryAfterMs };
  }
  // 400, 401, 403 (VAPID or JWT refused), 413 (payload too large)…
  return { kind: "rejected", error };
}

/** Exponential backoff after the given (1-based) failed attempt: 30 s, 1 min, 2 min… capped at an hour. */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const backoff = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_RETRY_MS, Math.max(backoff, retryAfterMs ?? 0));
}

/** Plain text from the start of a markdown comment, for a notification body. */
export function excerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Chrome · macOS" style name for a subscribed browser, from its user agent. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return [browser, os].filter(Boolean).join(" · ") || "Browser";
}
