import "server-only";

import { asc, count, eq, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
import { pushLocale } from "./notification";
import { deviceLabel, type PushSubscriptionJson } from "./shape";

const { pushSubscriptions, pushDeliveries } = schema;

export type PushDevice = {
  id: number;
  endpoint: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** Notifications still waiting to reach it (being retried). */
  pending: number;
};

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

/**
 * Stores (or refreshes) a browser's subscription. `previousEndpoint`: the
 * subscription this one replaces (pushsubscriptionchange), which is dropped and
 * whose language carries over when none is given.
 */
export async function saveSubscription(
  db: Db,
  input: {
    userId: number;
    subscription: PushSubscriptionJson;
    vapidPublicKey: string;
    locale?: string | null;
    userAgent?: string | null;
    previousEndpoint?: string | null;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    let locale = input.locale ?? null;
    const { previousEndpoint } = input;
    if (previousEndpoint && previousEndpoint !== input.subscription.endpoint) {
      const [previous] = await tx
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, previousEndpoint))
        .returning({ locale: pushSubscriptions.locale });
      locale ??= previous?.locale ?? null;
    }
    const values = {
      userId: input.userId,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      vapidPublicKey: input.vapidPublicKey,
      locale: pushLocale(locale),
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    };
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({ endpoint: input.subscription.endpoint, ...values })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          ...values,
          // Keep the old language when a refresh doesn't say.
          locale: input.locale ? values.locale : sql`${pushSubscriptions.locale}`,
          lastFailureAt: null,
          lastError: null,
        },
      })
      .returning({ id: pushSubscriptions.id });
    return row.id;
  });
}

/** Forgets a browser by its endpoint or id; true if there was one. */
export async function removeSubscription(db: Db, which: { endpoint: string } | { id: number }): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where("id" in which ? eq(pushSubscriptions.id, which.id) : eq(pushSubscriptions.endpoint, which.endpoint))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

/** Every subscribed browser, oldest first, for the settings page. */
export async function listPushDevices(db: Db): Promise<PushDevice[]> {
  const pending = db
    .select({ subscriptionId: pushDeliveries.subscriptionId, value: count().as("value") })
    .from(pushDeliveries)
    .groupBy(pushDeliveries.subscriptionId)
    .as("pending");
  const rows = await db
    .select({ subscription: pushSubscriptions, pending: pending.value })
    .from(pushSubscriptions)
    .leftJoin(pending, eq(pending.subscriptionId, pushSubscriptions.id))
    .orderBy(asc(pushSubscriptions.id));
  return rows.map(({ subscription: row, pending }) => ({
    id: row.id,
    endpoint: row.endpoint,
    label: deviceLabel(row.userAgent),
    createdAt: new Date(row.createdAt).toISOString(),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastFailureAt: iso(row.lastFailureAt),
    lastError: row.lastError,
    pending: Number(pending ?? 0),
  }));
}
