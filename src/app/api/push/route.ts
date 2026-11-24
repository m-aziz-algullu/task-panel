import { authorize, success, vapidOrFailure } from "@/lib/push/route-helpers";

/** The server's VAPID public key, for pushManager.subscribe() (the page and the service worker). */
export async function GET(request: Request) {
  const user = await authorize(request, false);
  if (user instanceof Response) return user;
  const vapid = await vapidOrFailure();
  if (vapid instanceof Response) return vapid;
  return success({ publicKey: vapid.publicKey });
}
