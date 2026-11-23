// Task Panel's service worker: shows Web Push notifications and opens the task
// when one is clicked. Nothing is cached; the app works as before without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Task Panel", {
      body: data.body || "",
      tag: data.tag || undefined,
      // A newer notification about the same task replaces the old one, and still alerts.
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL(event.notification.data?.url || "/", self.location.origin);
  // Only ever open this app's own pages.
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target.href).catch(() => self.clients.openWindow(target.href));
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

// The push service renewed or dropped the subscription: subscribe again and tell
// the server, so notifications keep coming without opening the settings page.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/api/push", { credentials: "same-origin" });
      if (!response.ok) return;
      const { data } = await response.json();
      const subscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: data.publicKey }));
      await fetch("/api/push/subscription", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          publicKey: data.publicKey,
          previousEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null,
        }),
      });
    })(),
  );
});
