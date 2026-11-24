"use client";

import { useEffect } from "react";
import { useI18n } from "@/i18n/client";
import { existingSubscription, fetchPublicKey, pushSupport, subscribe, subscriptionKey } from "@/lib/push/browser";

/**
 * Keeps this browser's push subscription working without a visit to the
 * settings page: picks up a new service worker, and subscribes again if the
 * server's VAPID key changed (the push service refuses the old subscription).
 * Does nothing in a browser that never turned notifications on.
 */
export function PushSync() {
  const { locale } = useI18n();

  useEffect(() => {
    if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration) return;
      await registration.update().catch(() => {});
      const subscription = await existingSubscription();
      if (!subscription) return;
      const key = await fetchPublicKey();
      if (key.ok && subscriptionKey(subscription) !== key.data.publicKey) {
        await subscribe(key.data.publicKey, locale);
      }
    })().catch((error) => console.warn("[push] Could not refresh the subscription:", error));
  }, [locale]);

  return null;
}
