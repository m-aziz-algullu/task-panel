// public/sw.js, run in a fake service worker global: what it shows for a push,
// where a click takes the user, and how it renews a subscription.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://panel.example.com";

type Listener = (event: Record<string, unknown>) => void;

function worker(options: { windows?: { url: string }[]; fetch?: ReturnType<typeof vi.fn> } = {}) {
  const listeners = new Map<string, Listener>();
  const windows = (options.windows ?? []).map((window) => ({
    ...window,
    focus: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
  }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async () => {}),
      pushManager: { subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://push.example.com/new" }) })) },
    },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => {}) },
  };
  runInNewContext(SOURCE, { self, URL, fetch: options.fetch ?? vi.fn(), JSON });

  /** Dispatches an event and waits for what it passed to waitUntil. */
  async function dispatch(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  }
  return { self, windows, dispatch };
}

const notificationWith = (url: unknown) => ({ close: vi.fn(), data: { url } });

describe("service worker", () => {
  it("shows the pushed notification, replacing older ones about the same task", async () => {
    const { self, dispatch } = worker();
    const payload = { title: "Agent finished: Report", body: "Done.", url: "/en?task=4", tag: "task-4" };
    await dispatch("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("Agent finished: Report", {
      body: "Done.",
      tag: "task-4",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: "/en?task=4" },
    });
  });

  it("still shows something for an empty or non-JSON push", async () => {
    const { self, dispatch } = worker();
    await dispatch("push", { data: null });
    expect(self.registration.showNotification).toHaveBeenLastCalledWith("Task Panel", expect.objectContaining({ body: "" }));
    await dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
        text: () => "plain text",
      },
    });
    expect(self.registration.showNotification).toHaveBeenLastCalledWith("Task Panel", expect.objectContaining({ body: "plain text" }));
  });

  it("opens the task in an open tab of the app", async () => {
    const { self, windows, dispatch } = worker({ windows: [{ url: "https://other.example.com/" }, { url: `${ORIGIN}/en/settings` }] });
    const notification = notificationWith("/en?task=4");
    await dispatch("notificationclick", { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(windows[1].focus).toHaveBeenCalled();
    expect(windows[1].navigate).toHaveBeenCalledWith(`${ORIGIN}/en?task=4`);
    expect(windows[0].focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when the app isn't open, and never another site", async () => {
    const { self, dispatch } = worker();
    await dispatch("notificationclick", { notification: notificationWith("/tr?task=9") });
    expect(self.clients.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/tr?task=9`);
    await dispatch("notificationclick", { notification: notificationWith("https://evil.example.com/phish") });
    expect(self.clients.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
  });

  it("subscribes again and tells the server when the push service renews the subscription", async () => {
    const fetch = vi.fn(async (url: string) =>
      url === "/api/push" ? { ok: true, json: async () => ({ ok: true, data: { publicKey: "KEY" } }) } : { ok: true },
    );
    const { self, dispatch } = worker({ fetch });
    await dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example.com/old" }, newSubscription: null });
    expect(self.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: "KEY" });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/push/subscription");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      subscription: { endpoint: "https://push.example.com/new" },
      publicKey: "KEY",
      previousEndpoint: "https://push.example.com/old",
    });
  });

  it("does nothing on a subscription change when signed out", async () => {
    const fetch = vi.fn(async () => ({ ok: false }));
    const { self, dispatch } = worker({ fetch });
    await dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
    expect(self.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
