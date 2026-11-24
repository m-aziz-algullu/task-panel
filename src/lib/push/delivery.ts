import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { generateRequestDetails } from "web-push";
import { schema, type Db } from "../db";
import { runEndMessage, type PushMessage, type RunEnd } from "./notification";
import {
  MAX_PUSH_ATTEMPTS,
  PUSH_TTL_SECONDS,
  classifyPushResponse,
  retryDelayMs,
  type PushOutcome,
  type PushPayload,
} from "./shape";
import { getVapidKeys, type VapidKeys } from "./vapid";

const { pushSubscriptions, pushDeliveries, tasks } = schema;

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;
type DeliveryRow = typeof pushDeliveries.$inferSelect;

/** How long a claimed delivery is held before another worker may take it (a crash mid-send). */
const CLAIM_LEASE_SECONDS = 5 * 60;
/** One push service request at most; well inside the lease. */
const SEND_TIMEOUT_MS = 15_000;
/** Deliveries one batch takes. */
const BATCH_SIZE = 20;

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

const secondsFromNow = (seconds: number) => sql`now() + make_interval(secs => ${seconds})`;

/**
 * Puts a notification in the outbox, once per subscribed browser (in that
 * browser's language). Call it inside the transaction that records what it's
 * about: it is then sent exactly when that commits. Returns the delivery ids.
 */
export async function queuePush(
  db: Db,
  message: (locale: string) => PushMessage | null,
  only?: { subscriptionId: number },
): Promise<number[]> {
  const subscriptions = await db
    .select({ id: pushSubscriptions.id, locale: pushSubscriptions.locale })
    .from(pushSubscriptions)
    .where(only ? eq(pushSubscriptions.id, only.subscriptionId) : undefined);
  const rows = subscriptions.flatMap((subscription) => {
    const built = message(subscription.locale);
    return built
      ? [
          {
            subscriptionId: subscription.id,
            payload: built.payload,
            topic: built.topic,
            expiresAt: secondsFromNow(PUSH_TTL_SECONDS),
          },
        ]
      : [];
  });
  if (rows.length === 0) return [];
  const inserted = await db.insert(pushDeliveries).values(rows).returning({ id: pushDeliveries.id });
  return inserted.map((row) => row.id);
}

/**
 * Queues "the agent finished / needs you" for a run that just ended. Runs in
 * finalizeRun's transaction, in a savepoint: a problem here is logged and never
 * stops the run from ending.
 */
export async function queueRunEndPush(
  db: Db,
  end: Omit<RunEnd, "task"> & { taskId: number },
): Promise<number[]> {
  try {
    return await db.transaction(async (tx) => {
      const [task] = await tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, end.taskId));
      if (!task) return [];
      return queuePush(tx, (locale) => runEndMessage({ status: end.status, task, comment: end.comment }, locale));
    });
  } catch (error) {
    console.error(`[push] Could not queue the notification for task ${end.taskId}:`, error);
    return [];
  }
}

export type PushSender = (input: {
  subscription: Pick<SubscriptionRow, "endpoint" | "p256dh" | "auth">;
  payload: PushPayload;
  topic: string | null;
  ttlSeconds: number;
  vapid: VapidKeys;
}) => Promise<PushOutcome>;

/** Encrypts the payload for the browser (RFC 8291), signs a VAPID JWT (RFC 8292) and POSTs it (RFC 8030). */
export const sendWebPush: PushSender = async ({ subscription, payload, topic, ttlSeconds, vapid }) => {
  const details = generateRequestDetails(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
    {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: ttlSeconds,
      urgency: "normal",
      ...(topic ? { topic } : {}),
    },
  );
  const headers = Object.fromEntries(Object.entries(details.headers).map(([name, value]) => [name, String(value)]));
  let response: Response;
  try {
    response = await fetch(details.endpoint, {
      method: details.method,
      headers,
      body: details.body ? new Uint8Array(details.body) : null,
      redirect: "manual",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : String(error);
    return { kind: "retry", error: `Network error: ${reason}` };
  }
  const detail = response.ok ? "" : (await response.text().catch(() => "")).trim();
  return classifyPushResponse(response.status, detail, response.headers.get("retry-after"));
};

export type DeliveryResult = {
  id: number;
  subscriptionId: number;
  result: PushOutcome["kind"] | "expired" | "stale";
  error?: string;
};

/** Takes up to `limit` due deliveries, leasing them so no other worker sends them meanwhile. */
async function claimDue(db: Db, limit: number): Promise<{ delivery: DeliveryRow; subscription: SubscriptionRow }[]> {
  const claimed = rowsOf<{ id: number }>(
    await db.execute(sql`
      UPDATE push_deliveries SET attempts = attempts + 1, next_attempt_at = ${secondsFromNow(CLAIM_LEASE_SECONDS)}
      WHERE id IN (
        SELECT id FROM push_deliveries
        WHERE next_attempt_at <= now()
        ORDER BY next_attempt_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`),
  ).map((row) => Number(row.id));
  if (claimed.length === 0) return [];
  return db
    .select({ delivery: pushDeliveries, subscription: pushSubscriptions })
    .from(pushDeliveries)
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.id, pushDeliveries.subscriptionId))
    .where(inArray(pushDeliveries.id, claimed));
}

async function noteFailure(db: Db, subscriptionId: number, error: string) {
  await db
    .update(pushSubscriptions)
    .set({ lastFailureAt: sql`now()`, lastError: error.slice(0, 500) })
    .where(eq(pushSubscriptions.id, subscriptionId));
}

/** One claimed delivery: send it and record what happened. */
async function deliver(
  db: Db,
  { delivery, subscription }: { delivery: DeliveryRow; subscription: SubscriptionRow },
  vapid: VapidKeys,
  send: PushSender,
): Promise<DeliveryResult> {
  const base = { id: delivery.id, subscriptionId: subscription.id };
  const secondsLeft = Math.floor((new Date(delivery.expiresAt).getTime() - Date.now()) / 1000);
  if (secondsLeft <= 0) {
    await db.delete(pushDeliveries).where(eq(pushDeliveries.id, delivery.id));
    console.warn(`[push] Dropped notification ${delivery.id}: not delivered within a day.`);
    return { ...base, result: "expired" };
  }
  // Subscribed under an older server key: the push service would refuse it. The
  // browser subscribes again with the new key the next time the app is opened.
  if (subscription.vapidPublicKey !== vapid.publicKey) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
    console.warn(`[push] Dropped subscription ${subscription.id}: made with another VAPID key.`);
    return { ...base, result: "stale" };
  }

  let outcome: PushOutcome;
  try {
    outcome = await send({
      subscription,
      payload: delivery.payload,
      topic: delivery.topic,
      ttlSeconds: secondsLeft,
      vapid,
    });
  } catch (error) {
    // Couldn't even build the request (e.g. keys the library refuses): retrying won't help.
    outcome = { kind: "rejected", error: error instanceof Error ? error.message : String(error) };
  }

  switch (outcome.kind) {
    case "delivered":
      await db.delete(pushDeliveries).where(eq(pushDeliveries.id, delivery.id));
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: sql`now()`, lastFailureAt: null, lastError: null })
        .where(eq(pushSubscriptions.id, subscription.id));
      return { ...base, result: "delivered" };
    case "gone":
      // Its deliveries go with it (ON DELETE CASCADE).
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      console.log(`[push] Subscription ${subscription.id} is gone (${outcome.error}); removed.`);
      return { ...base, result: "gone", error: outcome.error };
    case "rejected":
      await db.delete(pushDeliveries).where(eq(pushDeliveries.id, delivery.id));
      await noteFailure(db, subscription.id, outcome.error);
      console.warn(`[push] Notification ${delivery.id} refused by the push service: ${outcome.error}`);
      return { ...base, result: "rejected", error: outcome.error };
    case "retry": {
      await noteFailure(db, subscription.id, outcome.error);
      if (delivery.attempts >= MAX_PUSH_ATTEMPTS) {
        await db.delete(pushDeliveries).where(eq(pushDeliveries.id, delivery.id));
        console.warn(`[push] Gave up on notification ${delivery.id} after ${delivery.attempts} tries: ${outcome.error}`);
        return { ...base, result: "rejected", error: outcome.error };
      }
      const delaySeconds = retryDelayMs(delivery.attempts, outcome.retryAfterMs) / 1000;
      await db
        .update(pushDeliveries)
        .set({ nextAttemptAt: secondsFromNow(delaySeconds), lastError: outcome.error.slice(0, 500) })
        .where(eq(pushDeliveries.id, delivery.id));
      return { ...base, result: "retry", error: outcome.error };
    }
  }
}

/**
 * Sends every due notification (up to `maxBatches` batches). Safe to run from
 * several processes at once: each delivery is claimed by exactly one.
 */
export async function deliverDuePush(
  db: Db,
  options: { send?: PushSender; maxBatches?: number; vapid?: VapidKeys } = {},
): Promise<DeliveryResult[]> {
  const send = options.send ?? sendWebPush;
  const results: DeliveryResult[] = [];
  let vapid = options.vapid;
  for (let batch = 0; batch < (options.maxBatches ?? 10); batch++) {
    const due = await claimDue(db, BATCH_SIZE);
    if (due.length === 0) break;
    vapid ??= await getVapidKeys(db);
    const keys = vapid;
    // Different browsers usually mean different push services: send side by side.
    results.push(...(await Promise.all(due.map((item) => deliver(db, item, keys, send)))));
    if (due.length < BATCH_SIZE) break;
  }
  return results;
}

/** Milliseconds until the next delivery is due by the database clock; null if none is waiting. */
export async function msUntilNextPush(db: Db): Promise<number | null> {
  const [row] = rowsOf<{ ms: number | string | null }>(
    await db.execute(sql`SELECT extract(epoch FROM min(next_attempt_at) - now()) * 1000 AS ms FROM push_deliveries`),
  );
  return row?.ms == null ? null : Number(row.ms);
}
