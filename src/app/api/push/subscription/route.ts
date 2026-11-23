import { z } from "zod";
import { getDb } from "@/lib/db";
import { authorize, failure, readJson, success, vapidOrFailure } from "@/lib/push/route-helpers";
import { pushSubscriptionSchema } from "@/lib/push/shape";
import { removeSubscription, saveSubscription } from "@/lib/push/subscriptions";

const saveBody = z.object({
  subscription: pushSubscriptionSchema,
  /** The application server key the browser subscribed with. */
  publicKey: z.string().max(200),
  locale: z.string().max(10).nullish(),
  /** The subscription this one replaces (sent by the service worker on pushsubscriptionchange). */
  previousEndpoint: z.string().max(2048).nullish(),
});

const removeBody = z.union([z.object({ endpoint: z.string().max(2048) }), z.object({ id: z.number().int().positive() })]);

/** Turns notifications on for a browser (or refreshes its subscription). */
export async function POST(request: Request) {
  const user = await authorize(request, true);
  if (user instanceof Response) return user;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = saveBody.safeParse(raw);
  if (!body.success) return failure("errors.pushInvalidSubscription", 400);
  const vapid = await vapidOrFailure();
  if (vapid instanceof Response) return vapid;
  // Subscribed with a key this server no longer uses: the browser has to subscribe again.
  if (body.data.publicKey.replace(/=+$/, "") !== vapid.publicKey) {
    return failure("errors.pushKeyChanged", 409);
  }
  const id = await saveSubscription(await getDb(), {
    userId: user.id,
    subscription: body.data.subscription,
    vapidPublicKey: vapid.publicKey,
    locale: body.data.locale,
    userAgent: request.headers.get("user-agent"),
    previousEndpoint: body.data.previousEndpoint,
  });
  return success({ id });
}

/** Turns notifications off for a browser: this one (by endpoint) or one in the list (by id). */
export async function DELETE(request: Request) {
  const user = await authorize(request, true);
  if (user instanceof Response) return user;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = removeBody.safeParse(raw);
  if (!body.success) return failure("errors.invalid", 400);
  const removed = await removeSubscription(await getDb(), body.data);
  return success({ removed });
}
