// Web Push in the browser: the service worker, the PushManager subscription and
// the /api/push calls. Client-only (uses window and navigator).

import type { MessageKey } from "@/i18n/translate";
import { base64UrlBytes, bytesToBase64Url } from "./shape";

export type PushSupport = "ok" | "insecure" | "ios-install" | "unsupported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iOS and iPadOS only offer Web Push to a site opened from the Home Screen.
  if (!supported) return ios ? "ios-install" : "unsupported";
  return "ok";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** This browser's subscription, if it has one (without registering anything). */
export async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The application server key a subscription was made with, as the server writes it. */
export function subscriptionKey(subscription: PushSubscription): string | null {
  const key = subscription.options?.applicationServerKey;
  return key ? bytesToBase64Url(key) : null;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: MessageKey };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const body = (await response.json().catch(() => null)) as ApiResult<T> | null;
    return body ?? { ok: false, error: "errors.generic" };
  } catch {
    return { ok: false, error: "errors.generic" };
  }
}

export function fetchPublicKey() {
  return call<{ publicKey: string }>("/api/push");
}

export function saveSubscription(subscription: PushSubscription, publicKey: string, locale: string) {
  return call<{ id: number }>("/api/push/subscription", {
    method: "POST",
    body: JSON.stringify({ subscription: subscription.toJSON(), publicKey, locale }),
  });
}

export function deleteSubscription(which: { endpoint: string } | { id: number }) {
  return call<{ removed: boolean }>("/api/push/subscription", { method: "DELETE", body: JSON.stringify(which) });
}

export type TestResult = { result: "delivered" | "retry" | "rejected" | "gone" | "expired" | "stale" | "queued"; error: string | null };

export function sendTest(endpoint: string) {
  return call<TestResult>("/api/push/test", { method: "POST", body: JSON.stringify({ endpoint }) });
}

/**
 * Subscribes this browser with the server's current key (replacing a
 * subscription made with an older one) and stores it on the server.
 */
export async function subscribe(publicKey: string, locale: string): Promise<ApiResult<PushSubscription>> {
  const registration = await registerServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && subscriptionKey(subscription) !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  const applicationServerKey = base64UrlBytes(publicKey);
  if (!applicationServerKey) return { ok: false, error: "errors.pushMisconfigured" };
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as Uint8Array<ArrayBuffer>,
  });
  const saved = await saveSubscription(subscription, publicKey, locale);
  return saved.ok ? { ok: true, data: subscription } : saved;
}
