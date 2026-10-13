import "server-only";

import { and, asc, count, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { schema, type Db } from "./db";
import { WINDOW_MINUTES, clientIpFrom, exceeded, minutesUntil, type Limit } from "./rate-limit-rules";

const { authAttempts } = schema;
const windowStart = sql`now() - make_interval(mins => ${WINDOW_MINUTES})`;

export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}

/**
 * Records an attempt for every limit, then checks the counts. Recording first
 * means a burst of parallel requests can't all slip through before any of them
 * is counted. Returns the minutes to wait when blocked, otherwise null.
 * Blocked attempts are refused before any password or code is checked.
 */
export async function recordAttempt(db: Db, limits: Limit[]): Promise<number | null> {
  const keys = limits.map((limit) => limit.key);
  await db.insert(authAttempts).values(keys.map((key) => ({ key })));
  await db.delete(authAttempts).where(lt(authAttempts.at, sql`now() - interval '1 day'`));

  const rows = await db
    .select({ key: authAttempts.key, value: count() })
    .from(authAttempts)
    .where(and(inArray(authAttempts.key, keys), gt(authAttempts.at, windowStart)))
    .groupBy(authAttempts.key);
  const over = exceeded(limits, new Map(rows.map((row) => [row.key, row.value])));
  if (over.length === 0) return null;

  // Free again once enough of the oldest attempts have left the window.
  let waitSeconds = 0;
  for (const limit of over) {
    const total = rows.find((row) => row.key === limit.key)!.value;
    const [freeing] = await db
      .select({
        seconds: sql<number>`extract(epoch from (${authAttempts.at} + make_interval(mins => ${WINDOW_MINUTES}) - now()))`,
      })
      .from(authAttempts)
      .where(and(eq(authAttempts.key, limit.key), gt(authAttempts.at, windowStart)))
      .orderBy(asc(authAttempts.at))
      .offset(total - limit.max)
      .limit(1);
    waitSeconds = Math.max(waitSeconds, Number(freeing?.seconds ?? 0));
  }
  return minutesUntil(waitSeconds);
}

/** After a success: the attempts that led to it no longer count. */
export async function clearAttempts(db: Db, limits: Limit[]): Promise<void> {
  await db.delete(authAttempts).where(
    inArray(
      authAttempts.key,
      limits.map((limit) => limit.key),
    ),
  );
}
