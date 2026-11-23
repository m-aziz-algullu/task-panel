import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { deliverDuePush, queuePush } from "@/lib/push/delivery";
import { testMessage } from "@/lib/push/notification";
import { authorize, failure, readJson, success, vapidOrFailure } from "@/lib/push/route-helpers";

const { pushSubscriptions } = schema;

const body = z.object({ endpoint: z.string().max(2048) });

/**
 * Sends a test notification to this browser right away and says how the push
 * service answered, so a problem shows up on the settings page, not in the logs.
 */
export async function POST(request: Request) {
  const user = await authorize(request, true);
  if (user instanceof Response) return user;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return failure("errors.invalid", 400);
  const vapid = await vapidOrFailure();
  if (vapid instanceof Response) return vapid;

  const db = await getDb();
  const [subscription] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  if (!subscription) return failure("errors.pushNotSubscribed", 404);

  const [id] = await queuePush(db, testMessage, { subscriptionId: subscription.id });
  // Usually this request sends it; if the dispatcher got there first, it's on its way.
  const results = await deliverDuePush(db, { vapid, maxBatches: 1 });
  const mine = results.find((result) => result.id === id);
  return success({ result: mine?.result ?? "queued", error: mine?.error ?? null });
}
