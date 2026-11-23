// Web Push end to end on a real (in-memory PGlite) database: the outbox written
// when a run ends, delivery to a local push service (payload decrypted and VAPID
// JWT checked as a browser and push service would), retries, expired and gone
// subscriptions, VAPID key handling and the /api/push route handlers.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  return { user: null as { id: number; name: string; email: string; role: string } | null };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => state.user),
  requireSession: vi.fn(async () => state.user),
}));

import { generateVAPIDKeys } from "web-push";
import * as keyRoute from "@/app/api/push/route";
import * as subscriptionRoute from "@/app/api/push/subscription/route";
import * as testRoute from "@/app/api/push/test/route";
import { claimNextRun, enqueueRun, finalizeRun } from "@/lib/agent/runs";
import { systemCommentBody } from "@/lib/agent/system-comments";
import { schema, type Db } from "@/lib/db";
import { deliverDuePush, queuePush, queueRunEndPush, sendWebPush, type PushSender } from "@/lib/push/delivery";
import { testMessage } from "@/lib/push/notification";
import { MAX_PUSH_ATTEMPTS, type PushPayload } from "@/lib/push/shape";
import { listPushDevices, removeSubscription, saveSubscription } from "@/lib/push/subscriptions";
import { VapidConfigError, getVapidKeys, vapidKeysFromEnv } from "@/lib/push/vapid";
import { browserKeys, decryptPush, startPushService, verifyVapid, type Reply } from "../push-service";
import { resetDb, rowsOf } from "./helpers";

const { tasks, users, pushSubscriptions, pushDeliveries, appSettings } = schema;

const runInput = {
  agentId: null,
  model: null,
  thinking: null,
  timeoutSeconds: 600,
  tokenLimit: 100_000,
  limitMode: "hard" as const,
};

let db: Db;
let userId: number;
let reply: (path: string) => Reply = () => ({ status: 201 });
let service: Awaited<ReturnType<typeof startPushService>>;

beforeAll(async () => {
  service = await startPushService((request) => reply(request.path));
});

afterAll(async () => {
  await service.close();
});

beforeEach(async () => {
  db = await resetDb();
  reply = () => ({ status: 201 });
  service.received.length = 0;
  const [user] = await db
    .insert(users)
    .values({ name: "Aziz", email: "aziz@example.com", passwordHash: "x" })
    .returning({ id: users.id });
  userId = user.id;
  state.user = { id: userId, name: "Aziz", email: "aziz@example.com", role: "admin" };
});

async function task(title = "Write the report"): Promise<number> {
  const [row] = await db
    .insert(tasks)
    .values({ title, status: "in_progress", day: "2026-11-23", dueDate: "2026-11-23", position: 0 })
    .returning({ id: tasks.id });
  return row.id;
}

/** A browser subscribed to the local push service with the server's current key. */
async function subscribe(name: string, locale = "en") {
  const browser = browserKeys();
  const { publicKey } = await getVapidKeys(db);
  const endpoint = service.endpoint(name);
  const id = await saveSubscription(db, {
    userId,
    subscription: { endpoint, keys: browser.keys },
    vapidPublicKey: publicKey,
    locale,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  });
  return { id, endpoint, browser };
}

async function runningRun(taskId: number) {
  const run = (await enqueueRun(db, taskId, runInput, "manual"))!;
  await claimNextRun(db);
  return run;
}

const deliveries = () => db.select().from(pushDeliveries).orderBy(pushDeliveries.id);
const subscriptionRow = async (id: number) =>
  (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)))[0];

/** Makes every waiting delivery due now (as if its retry time had come). */
async function makeDue() {
  await db.execute(sql`UPDATE push_deliveries SET next_attempt_at = now() - interval '1 second'`);
}

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://panel.test${url}`, {
    method,
    headers: { host: "panel.test", origin: "http://panel.test", "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("VAPID keys", () => {
  it("generates a pair once and keeps it", async () => {
    const first = await getVapidKeys(db);
    const second = await getVapidKeys(db);
    expect(second).toEqual(first);
    expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(65);
    expect(first.subject).toBe("mailto:aziz@example.com");
    const stored = await db.select().from(appSettings).where(eq(appSettings.key, "push.vapid"));
    expect(stored).toHaveLength(1);
  });

  it("is the same pair when two requests ask at once", async () => {
    const [a, b, c] = await Promise.all([getVapidKeys(db), getVapidKeys(db), getVapidKeys(db)]);
    expect(b.publicKey).toBe(a.publicKey);
    expect(c.publicKey).toBe(a.publicKey);
  });

  it("prefers a matching pair from the environment", async () => {
    const pair = generateVAPIDKeys();
    const env = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: "https://panel.example.com" };
    expect(await getVapidKeys(db, env)).toEqual({ ...pair, subject: "https://panel.example.com" });
  });

  it("refuses a half-set, mismatched or malformed environment", async () => {
    const one = generateVAPIDKeys();
    const other = generateVAPIDKeys();
    expect(() => vapidKeysFromEnv({ VAPID_PUBLIC_KEY: one.publicKey })).toThrow(VapidConfigError);
    expect(() => vapidKeysFromEnv({ VAPID_PUBLIC_KEY: one.publicKey, VAPID_PRIVATE_KEY: other.privateKey })).toThrow(
      /does not belong/,
    );
    expect(() => vapidKeysFromEnv({ VAPID_PUBLIC_KEY: one.publicKey, VAPID_PRIVATE_KEY: "nope" })).toThrow(VapidConfigError);
    await expect(getVapidKeys(db, { VAPID_SUBJECT: "aziz@example.com" })).rejects.toThrow(VapidConfigError);
  });
});

describe("queueing notifications when a run ends", () => {
  it("queues one per device, in that device's language, in the run's transaction", async () => {
    const taskId = await task();
    const en = await subscribe("en", "en");
    const tr = await subscribe("tr", "tr");
    const run = await runningRun(taskId);

    await finalizeRun(db, run, {
      status: "done",
      moveTo: "pending",
      comment: { author: "agent", body: "Report **written**." },
    });

    const rows = await deliveries();
    expect(rows.map((row) => [row.subscriptionId, row.payload.title, row.payload.body])).toEqual([
      [en.id, "Agent finished: Write the report", "Report written."],
      [tr.id, "Ajan bitirdi: Write the report", "Report written."],
    ]);
    expect(rows[0]).toMatchObject({ topic: `task-${taskId}`, attempts: 0 });
    expect(rows[0].payload.url).toBe(`/en?task=${taskId}`);
    // Lives for a day.
    const ttl = new Date(rows[0].expiresAt).getTime() - new Date(rows[0].createdAt).getTime();
    expect(ttl).toBe(24 * 60 * 60 * 1000);
  });

  it("tells the user why a stuck run stopped", async () => {
    const taskId = await task();
    await subscribe("phone");
    const run = await runningRun(taskId);
    await finalizeRun(db, run, {
      status: "budget_exceeded",
      moveTo: "pending",
      comment: { author: "system", body: systemCommentBody("agentRun.systemBudget", { used: 120_000, limit: 100_000 }) },
    });
    const [row] = await deliveries();
    expect(row.payload.title).toBe("Agent needs you: Write the report");
    expect(row.payload.body).not.toMatch(/agentRun|\{/);
  });

  it("queues nothing when the user stopped the run, or twice for one run", async () => {
    const taskId = await task();
    await subscribe("phone");
    const stopped = await runningRun(taskId);
    await finalizeRun(db, stopped, { status: "aborted" });
    expect(await deliveries()).toEqual([]);

    const run = await runningRun(taskId);
    expect(await finalizeRun(db, run, { status: "failed", error: "boom" })).toBe(true);
    expect(await finalizeRun(db, run, { status: "done" })).toBe(false);
    expect(await deliveries()).toHaveLength(1);
  });

  it("queues nothing without subscribed devices", async () => {
    const run = await runningRun(await task());
    await finalizeRun(db, run, { status: "done" });
    expect(await deliveries()).toEqual([]);
  });

  it("never lets a notification problem stop the run from ending", async () => {
    const taskId = await task();
    await subscribe("phone");
    const run = await runningRun(taskId);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(sql`ALTER TABLE push_deliveries RENAME TO push_deliveries_away`);
    let logged = 0;
    try {
      expect(await finalizeRun(db, run, { status: "done", moveTo: "pending" })).toBe(true);
      logged = error.mock.calls.length;
    } finally {
      await db.execute(sql`ALTER TABLE push_deliveries_away RENAME TO push_deliveries`);
      error.mockRestore();
    }
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row.status).toBe("pending");
    expect(logged).toBe(1);
  });

  it("skips a task that no longer exists", async () => {
    await subscribe("phone");
    expect(await queueRunEndPush(db, { taskId: 999, status: "done" })).toEqual([]);
  });
});

describe("delivering", () => {
  it("encrypts for the browser, signs with VAPID and empties the outbox", async () => {
    const taskId = await task();
    const phone = await subscribe("phone");
    const run = await runningRun(taskId);
    await finalizeRun(db, run, { status: "done", comment: { author: "agent", body: "Finished." } });

    const results = await deliverDuePush(db);
    expect(results).toEqual([{ id: expect.any(Number), subscriptionId: phone.id, result: "delivered" }]);

    const [received] = service.received;
    expect(received.path).toBe("/push/phone");
    expect(received.headers["content-encoding"]).toBe("aes128gcm");
    expect(received.headers.topic).toBe(`task-${taskId}`);
    expect(received.headers.urgency).toBe("normal");
    expect(Number(received.headers.ttl)).toBeGreaterThan(24 * 60 * 60 - 60);
    expect(Number(received.headers.ttl)).toBeLessThanOrEqual(24 * 60 * 60);

    const vapid = await getVapidKeys(db);
    const claims = verifyVapid(received.headers.authorization, vapid.publicKey);
    expect(claims.aud).toBe(service.origin);
    expect(claims.sub).toBe("mailto:aziz@example.com");
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());

    const payload = JSON.parse(decryptPush(received.body, phone.browser)) as PushPayload;
    expect(payload).toEqual({
      title: "Agent finished: Write the report",
      body: "Finished.",
      url: `/en?task=${taskId}`,
      tag: `task-${taskId}`,
    });

    expect(await deliveries()).toEqual([]);
    expect((await subscriptionRow(phone.id)).lastSuccessAt).toBeInstanceOf(Date);
  });

  it("forgets a subscription the push service says is gone", async () => {
    const gone = await subscribe("gone");
    const kept = await subscribe("kept");
    reply = (path) => (path.endsWith("/gone") ? { status: 410, body: "unsubscribed" } : { status: 201 });
    await queuePush(db, testMessage);
    // A second notification for the gone device goes with it.
    await queuePush(db, testMessage, { subscriptionId: gone.id });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const results = await deliverDuePush(db);
    log.mockRestore();
    expect(results.filter((r) => r.result === "gone").map((r) => r.subscriptionId)).toContain(gone.id);
    expect(results.find((r) => r.subscriptionId === kept.id)?.result).toBe("delivered");
    expect(await subscriptionRow(gone.id)).toBeUndefined();
    expect(await deliveries()).toEqual([]);
  });

  it("retries a throttled delivery no sooner than Retry-After, then delivers it", async () => {
    const phone = await subscribe("phone");
    reply = () => ({ status: 429, headers: { "Retry-After": "600" }, body: "slow down" });
    await queuePush(db, testMessage);

    expect((await deliverDuePush(db))[0]).toMatchObject({ result: "retry", error: "HTTP 429: slow down" });
    const [waiting] = await deliveries();
    expect(waiting.attempts).toBe(1);
    expect(waiting.lastError).toBe("HTTP 429: slow down");
    const wait = new Date(waiting.nextAttemptAt).getTime() - Date.now();
    expect(wait).toBeGreaterThan(590_000);
    expect(wait).toBeLessThanOrEqual(600_000);
    expect(await subscriptionRow(phone.id)).toMatchObject({ lastError: "HTTP 429: slow down" });
    expect((await listPushDevices(db))[0].pending).toBe(1);

    // Not due yet: nothing is sent.
    expect(await deliverDuePush(db)).toEqual([]);

    reply = () => ({ status: 201 });
    await makeDue();
    expect((await deliverDuePush(db))[0].result).toBe("delivered");
    expect(await deliveries()).toEqual([]);
    expect(await subscriptionRow(phone.id)).toMatchObject({ lastError: null, lastFailureAt: null });
    expect(service.received).toHaveLength(2);
  });

  it("gives up after the last attempt", async () => {
    await subscribe("phone");
    reply = () => ({ status: 503 });
    await queuePush(db, testMessage);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
      await makeDue();
      outcomes.push(...(await deliverDuePush(db)).map((r) => r.result));
    }
    warn.mockRestore();
    expect(outcomes).toEqual([...Array(MAX_PUSH_ATTEMPTS - 1).fill("retry"), "rejected"]);
    expect(service.received).toHaveLength(MAX_PUSH_ATTEMPTS);
    expect(await deliveries()).toEqual([]);
  });

  it("drops a refused notification but keeps the device, with the reason", async () => {
    const phone = await subscribe("phone");
    reply = () => ({ status: 403, body: "BadJwtToken" });
    await queuePush(db, testMessage);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await deliverDuePush(db))[0].result).toBe("rejected");
    warn.mockRestore();
    expect(await deliveries()).toEqual([]);
    expect((await listPushDevices(db))[0]).toMatchObject({ id: phone.id, lastError: "HTTP 403: BadJwtToken", pending: 0 });
  });

  it("retries when the push service can't be reached", async () => {
    const browser = browserKeys();
    const { publicKey } = await getVapidKeys(db);
    // Nothing listens on port 9.
    await saveSubscription(db, {
      userId,
      subscription: { endpoint: "http://127.0.0.1:9/push/offline", keys: browser.keys },
      vapidPublicKey: publicKey,
    });
    await queuePush(db, testMessage);
    const [result] = await deliverDuePush(db);
    expect(result.result).toBe("retry");
    expect(result.error).toMatch(/^Network error/);
  });

  it("drops a notification that is a day old instead of sending it", async () => {
    await subscribe("phone");
    await queuePush(db, testMessage);
    await db.execute(sql`UPDATE push_deliveries SET expires_at = now() - interval '1 minute'`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await deliverDuePush(db))[0].result).toBe("expired");
    warn.mockRestore();
    expect(service.received).toHaveLength(0);
    expect(await deliveries()).toEqual([]);
  });

  it("drops a subscription made with an older server key without sending", async () => {
    const phone = await subscribe("phone");
    await db.update(pushSubscriptions).set({ vapidPublicKey: generateVAPIDKeys().publicKey });
    await queuePush(db, testMessage);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await deliverDuePush(db))[0].result).toBe("stale");
    warn.mockRestore();
    expect(service.received).toHaveLength(0);
    expect(await subscriptionRow(phone.id)).toBeUndefined();
  });

  it("sends each notification once even with two dispatchers at work", async () => {
    for (const name of ["a", "b", "c"]) await subscribe(name);
    for (let i = 0; i < 10; i++) await queuePush(db, testMessage);
    let calls = 0;
    const slowSend: PushSender = async (input) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return sendWebPush(input);
    };
    const [first, second] = await Promise.all([deliverDuePush(db, { send: slowSend }), deliverDuePush(db, { send: slowSend })]);
    const ids = [...first, ...second].map((result) => result.id);
    expect(new Set(ids).size).toBe(30);
    expect(ids).toHaveLength(30);
    expect(calls).toBe(30);
    expect(service.received).toHaveLength(30);
  });

  it("leaves a claimed delivery to its claimant until the lease runs out", async () => {
    await subscribe("phone");
    await queuePush(db, testMessage);
    await db.execute(sql`UPDATE push_deliveries SET attempts = 1, next_attempt_at = now() + interval '5 minutes'`);
    expect(await deliverDuePush(db)).toEqual([]);
    const [row] = rowsOf<{ count: number }>(await db.execute(sql`SELECT count(*)::int AS count FROM push_deliveries`));
    expect(row.count).toBe(1);
  });
});

describe("subscriptions", () => {
  it("updates a known endpoint instead of adding it twice", async () => {
    const first = await subscribe("phone", "tr");
    const keys = browserKeys().keys;
    const { publicKey } = await getVapidKeys(db);
    await db.update(pushSubscriptions).set({ lastError: "old", lastFailureAt: new Date() });
    const again = await saveSubscription(db, {
      userId,
      subscription: { endpoint: first.endpoint, keys },
      vapidPublicKey: publicKey,
    });
    expect(again).toBe(first.id);
    expect(await subscriptionRow(first.id)).toMatchObject({ p256dh: keys.p256dh, locale: "tr", lastError: null });
  });

  it("replaces the previous subscription and keeps its language", async () => {
    const old = await subscribe("old", "tr");
    const { publicKey } = await getVapidKeys(db);
    const id = await saveSubscription(db, {
      userId,
      subscription: { endpoint: service.endpoint("new"), keys: browserKeys().keys },
      vapidPublicKey: publicKey,
      previousEndpoint: old.endpoint,
    });
    expect(await subscriptionRow(old.id)).toBeUndefined();
    expect(await subscriptionRow(id)).toMatchObject({ locale: "tr" });
  });

  it("goes when its user is deleted", async () => {
    await subscribe("phone");
    await db.delete(users);
    expect(await listPushDevices(db)).toEqual([]);
  });

  it("removes by endpoint or id", async () => {
    const a = await subscribe("a");
    const b = await subscribe("b");
    expect(await removeSubscription(db, { endpoint: a.endpoint })).toBe(true);
    expect(await removeSubscription(db, { id: b.id })).toBe(true);
    expect(await removeSubscription(db, { id: b.id })).toBe(false);
  });
});

describe("/api/push route handlers", () => {
  const browserSubscription = () => ({
    endpoint: "https://push.example.com/send/abc",
    expirationTime: null,
    keys: browserKeys().keys,
  });

  it("serves the public key to a signed-in user only", async () => {
    const response = await keyRoute.GET(request("GET", "/api/push"));
    expect(await response.json()).toEqual({ ok: true, data: { publicKey: (await getVapidKeys(db)).publicKey } });
    state.user = null;
    expect((await keyRoute.GET(request("GET", "/api/push"))).status).toBe(401);
  });

  it("stores a subscription with the browser's language and user agent", async () => {
    const { publicKey } = await getVapidKeys(db);
    const subscription = browserSubscription();
    const response = await subscriptionRoute.POST(
      request("POST", "/api/push/subscription", { subscription, publicKey, locale: "tr" }, { "user-agent": "Mozilla/5.0 (Android 15) Chrome/140.0" }),
    );
    expect(response.status).toBe(200);
    const [device] = await listPushDevices(db);
    expect(device).toMatchObject({ endpoint: subscription.endpoint, label: "Chrome · Android" });
    expect(await subscriptionRow(device.id)).toMatchObject({ locale: "tr", userId, vapidPublicKey: publicKey });
  });

  it("refuses strangers, other sites, bad subscriptions and an old key", async () => {
    const { publicKey } = await getVapidKeys(db);
    const body = { subscription: browserSubscription(), publicKey };

    expect((await subscriptionRoute.POST(request("POST", "/api/push/subscription", body, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await subscriptionRoute.POST(request("POST", "/api/push/subscription", body, { origin: "" }))).status).toBe(403);
    const http = { ...body, subscription: { ...body.subscription, endpoint: "http://push.example.com/x" } };
    const invalid = await subscriptionRoute.POST(request("POST", "/api/push/subscription", http));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "errors.pushInvalidSubscription" });
    const stale = await subscriptionRoute.POST(
      request("POST", "/api/push/subscription", { ...body, publicKey: generateVAPIDKeys().publicKey }),
    );
    expect(stale.status).toBe(409);
    const huge = await subscriptionRoute.POST(request("POST", "/api/push/subscription", { ...body, pad: "x".repeat(20_000) }));
    expect(huge.status).toBe(413);
    state.user = null;
    expect((await subscriptionRoute.POST(request("POST", "/api/push/subscription", body))).status).toBe(401);

    expect(await listPushDevices(db)).toEqual([]);
  });

  it("turns a device off", async () => {
    const phone = await subscribe("phone");
    const response = await subscriptionRoute.DELETE(request("DELETE", "/api/push/subscription", { endpoint: phone.endpoint }));
    expect(await response.json()).toEqual({ ok: true, data: { removed: true } });
    expect(await listPushDevices(db)).toEqual([]);
  });

  it("sends a test notification right away and reports the outcome", async () => {
    const phone = await subscribe("phone", "tr");
    const response = await testRoute.POST(request("POST", "/api/push/test", { endpoint: phone.endpoint }));
    expect(await response.json()).toEqual({ ok: true, data: { result: "delivered", error: null } });
    const payload = JSON.parse(decryptPush(service.received[0].body, phone.browser)) as PushPayload;
    expect(payload).toMatchObject({ title: "Task Panel", body: "Bu cihazda bildirimler çalışıyor.", url: "/tr/settings" });

    reply = () => ({ status: 403, body: "BadJwtToken" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = await testRoute.POST(request("POST", "/api/push/test", { endpoint: phone.endpoint }));
    warn.mockRestore();
    expect(await refused.json()).toEqual({ ok: true, data: { result: "rejected", error: "HTTP 403: BadJwtToken" } });

    const unknown = await testRoute.POST(request("POST", "/api/push/test", { endpoint: "https://nope.example.com" }));
    expect(unknown.status).toBe(404);
  });
});
