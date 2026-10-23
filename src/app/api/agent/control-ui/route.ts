import { gatewayConnection } from "@/lib/openclaw/connection";
import { getCurrentUser } from "@/lib/session";

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

// Opens OpenClaw's own Control UI, signed in. The Gateway token travels in the
// URL fragment, which never reaches server logs or Referer headers. In the Docker
// image the Control UI is on this site behind docker/control-ui-proxy.mjs; in
// development it is the Gateway's own address on this machine.
export async function GET() {
  if (!(await getCurrentUser())) return redirect("/");
  const gateway = gatewayConnection();
  if (!gateway) return new Response(null, { status: 404 });
  const base = process.env.TASKPANEL_CONTROL_UI_PATH || `${gateway.url.replace(/^ws/, "http")}/`;
  return redirect(`${base}#token=${encodeURIComponent(gateway.token)}`);
}
