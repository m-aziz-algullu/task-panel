import "server-only";

import type { MessageKey } from "@/i18n/translate";
import { getDb } from "../db";
import { readCapped, sameOrigin } from "../http";
import { getCurrentUser, type CurrentUser } from "../session";
import { VapidConfigError, getVapidKeys, type VapidKeys } from "./vapid";

// Shared by the /api/push route handlers. Route handlers rather than Server
// Actions because the service worker calls them too (pushsubscriptionchange).

const noStore = { "Cache-Control": "no-store" };
/** A subscription is a few hundred bytes; anything much bigger isn't one. */
const MAX_BODY_BYTES = 8 * 1024;

export function failure(error: MessageKey, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: noStore });
}

export function success<T>(data: T): Response {
  return Response.json({ ok: true, data }, { headers: noStore });
}

/** The signed-in user, or the response to send instead. `post`: also require same-origin. */
export async function authorize(request: Request, post: boolean): Promise<CurrentUser | Response> {
  if (post && !sameOrigin(request)) return failure("errors.invalid", 403);
  const user = await getCurrentUser();
  return user ?? failure("errors.unauthorized", 401);
}

/** The JSON body, or the response to send instead. */
export async function readJson(request: Request): Promise<unknown | Response> {
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return failure("errors.invalid", 413);
  try {
    return JSON.parse(text);
  } catch {
    return failure("errors.invalid", 400);
  }
}

/** The VAPID keys, or the response to send instead when the env sets them wrong. */
export async function vapidOrFailure(): Promise<VapidKeys | Response> {
  try {
    return await getVapidKeys(await getDb());
  } catch (error) {
    if (error instanceof VapidConfigError) {
      console.error(`[push] ${error.message}`);
      return failure("errors.pushMisconfigured", 503);
    }
    throw error;
  }
}
