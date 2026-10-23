import { getCurrentUser } from "@/lib/session";

// Asked by docker/control-ui-proxy.mjs before it lets a request through to the
// Gateway: 204 for a valid session, 401 otherwise.
export async function GET() {
  return new Response(null, { status: (await getCurrentUser()) ? 204 : 401, headers: { "cache-control": "no-store" } });
}
