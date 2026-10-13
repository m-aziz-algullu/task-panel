import "server-only";

import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { localizedRedirect } from "@/i18n/redirect";
import { cache } from "react";
import { SESSION_COOKIE, SESSION_TTL_MS, newSessionToken, sessionIdFromToken } from "./auth";
import { getDb, schema, type Db } from "./db";

const { users, sessions } = schema;

export type CurrentUser = { id: number; name: string; email: string; role: string };

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Session lookups hit the database, so they must never run while prerendering
  // (a no-op inside Server Actions, which already run per request).
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // The database's clock, not `new Date()`: Next.js forbids reading the time while prerendering.
    .where(and(eq(sessions.id, sessionIdFromToken(token)), gt(sessions.expiresAt, sql`now()`)));
  return row ?? null;
});

/** Redirects to the login page unless the request carries a valid session. */
export async function requireSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) return localizedRedirect("/login");
  return user;
}

export async function hasUsers(db?: Db): Promise<boolean> {
  const [row] = await (db ?? (await getDb())).select({ value: count() }).from(users);
  return (row?.value ?? 0) > 0;
}

async function isHttps(): Promise<boolean> {
  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

/** Creates a session row and sets its cookie. Call from a Server Action. */
export async function startSession(db: Db, userId: number): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
  await db.insert(sessions).values({ id: sessionIdFromToken(token), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sessionIdFromToken(token)));
  }
  store.delete(SESSION_COOKIE);
}
