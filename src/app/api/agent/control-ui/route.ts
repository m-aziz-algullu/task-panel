import { cookies } from "next/headers";
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALE_COOKIE, hasLocale } from "@/i18n/config";
import en from "@/i18n/dictionaries/en";
import tr from "@/i18n/dictionaries/tr";
import { translate } from "@/i18n/translate";
import { gatewayConnection, type GatewayConnection } from "@/lib/openclaw/connection";
import { getCurrentUser } from "@/lib/session";

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

/**
 * Whether the Gateway serves the Control UI under `path`. Right after a
 * redeploy it may still be starting, or waiting for the previous container to
 * release /data before Task Panel's settings (the base path among them) apply.
 */
async function servesControlUi(gateway: GatewayConnection, path: string): Promise<boolean> {
  try {
    const response = await fetch(`${gateway.url.replace(/^ws/, "http")}${path}control-ui-config.json`, {
      headers: { authorization: `Bearer ${gateway.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const { basePath } = (await response.json()) as { basePath?: string };
    return `${basePath ?? ""}/` === path;
  } catch {
    return false;
  }
}

async function notReady(): Promise<Response> {
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = hasLocale(remembered) ? remembered : DEFAULT_LOCALE;
  const t = (key: Parameters<typeof translate>[2]) => translate(locale === "tr" ? tr : en, INTL_LOCALE[locale], key);
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenClaw</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<p>${t("agentPage.controlUiNotReady")}</p>
<p><a href="/api/agent/control-ui">${t("agentPage.retry")}</a> · <a href="/${locale}/agent">${t("agentPage.openPage")}</a></p></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// Opens OpenClaw's own Control UI, signed in. The Gateway token travels in the
// URL fragment, which never reaches server logs or Referer headers. In the Docker
// image the Control UI is on this site behind docker/control-ui-proxy.mjs; in
// development it is the Gateway's own address on this machine.
export async function GET() {
  if (!(await getCurrentUser())) return redirect("/");
  const gateway = gatewayConnection();
  if (!gateway) return new Response(null, { status: 404 });
  const proxied = process.env.TASKPANEL_CONTROL_UI_PATH;
  if (proxied && !(await servesControlUi(gateway, proxied))) return notReady();
  const base = proxied || `${gateway.url.replace(/^ws/, "http")}/`;
  return redirect(`${base}#token=${encodeURIComponent(gateway.token)}`);
}
