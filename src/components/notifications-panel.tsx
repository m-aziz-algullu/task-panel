"use client";

import { Bell, BellOff, CircleAlert, CircleCheck, Info, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { formatDateTime } from "@/lib/dates";
import {
  deleteSubscription,
  existingSubscription,
  pushSupport,
  sendTest,
  subscribe,
  type PushSupport,
} from "@/lib/push/browser";
import type { PushDevice } from "@/lib/push/subscriptions";

type Notice = { kind: "error" | "info" | "success"; text: string } | null;

const SUPPORT_MESSAGES: Record<Exclude<PushSupport, "ok">, MessageKey> = {
  insecure: "push.insecure",
  "ios-install": "push.iosInstall",
  unsupported: "push.unsupported",
};

export function NotificationsPanel({
  devices,
  publicKey,
  timeZone,
}: {
  devices: PushDevice[];
  /** Null when the server's VAPID settings are wrong. */
  publicKey: string | null;
  timeZone: string;
}) {
  const { t, locale, intlLocale } = useI18n();
  const router = useRouter();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const inspect = useCallback(async () => {
    const found = pushSupport();
    setSupport(found);
    if (found !== "ok") return;
    setPermission(Notification.permission);
    setEndpoint((await existingSubscription().catch(() => null))?.endpoint ?? null);
  }, []);

  useEffect(() => {
    // Reads the browser's permission and subscription, which only exist on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void inspect();
  }, [inspect]);

  // On for this device: the browser holds a subscription the server knows about.
  const thisDevice = endpoint ? devices.find((device) => device.endpoint === endpoint) : undefined;
  const fail = (key: MessageKey, vars?: Record<string, string>) => setNotice({ kind: "error", text: t(key, vars) });

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    setNotice(null);
    try {
      // First thing in the click handler: browsers only ask from a user gesture.
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== "granted") return fail(answer === "denied" ? "push.denied" : "push.dismissed");
      const result = await subscribe(publicKey, locale);
      if (!result.ok) return fail(result.error);
      setEndpoint(result.data.endpoint);
      router.refresh();
    } catch (error) {
      fail("push.enableFailed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const subscription = await existingSubscription();
      if (subscription) {
        await deleteSubscription({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!endpoint) return;
    setBusy(true);
    setNotice(null);
    try {
      const sent = await sendTest(endpoint);
      if (!sent.ok) return fail(sent.error);
      const { result, error } = sent.data;
      if (result === "delivered" || result === "queued") setNotice({ kind: "success", text: t("push.testSent") });
      else if (result === "retry") setNotice({ kind: "info", text: t("push.testQueued", { error: error ?? "" }) });
      else if (result === "gone" || result === "stale" || result === "expired") fail("push.testGone");
      else fail("push.testFailed", { error: error ?? "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: PushDevice) => {
    setBusy(true);
    try {
      await deleteSubscription({ id: device.id });
      if (device.endpoint === endpoint) {
        await (await existingSubscription())?.unsubscribe();
        setEndpoint(null);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const when = (iso: string) => formatDateTime(iso, timeZone, intlLocale);

  let status: React.ReactNode;
  if (!publicKey) {
    status = <Message kind="error" text={t("errors.pushMisconfigured")} />;
  } else if (support === null) {
    status = <p className="text-sm text-muted">{t("push.checking")}</p>;
  } else if (support !== "ok") {
    status = <Message kind="info" text={t(SUPPORT_MESSAGES[support])} />;
  } else if (permission === "denied") {
    status = <Message kind="error" text={t("push.denied")} />;
  } else if (thisDevice) {
    status = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Bell className="size-4" /> {t("push.on")}
        </span>
        <button type="button" className="btn btn-outline" onClick={() => void test()} disabled={busy}>
          <Send className="size-4" /> {t("push.test")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void disable()} disabled={busy}>
          <BellOff className="size-4" /> {t("push.disable")}
        </button>
      </div>
    );
  } else {
    status = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 flex items-center gap-1.5 text-sm text-muted">
          <BellOff className="size-4" /> {t("push.off")}
        </span>
        <button type="button" className="btn btn-primary" onClick={() => void enable()} disabled={busy}>
          <Bell className="size-4" /> {t("push.enable")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4" aria-labelledby="push-title">
      <div>
        <h2 id="push-title" className="text-sm font-semibold">
          {t("push.title")}
        </h2>
        <p className="text-sm text-muted">{t("push.hint")}</p>
      </div>

      {status}
      <div aria-live="polite" className="empty:hidden">{notice && <Message kind={notice.kind} text={notice.text} />}</div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t("push.devices")}</h3>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">{t("push.noDevices")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {devices.map((device) => (
              <li key={device.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {device.label}
                    {device.endpoint === endpoint && (
                      <span className="ml-2 text-xs font-normal text-muted">({t("push.thisDevice")})</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {t("push.added", { when: when(device.createdAt) })}
                    {device.lastSuccessAt && ` · ${t("push.lastDelivered", { when: when(device.lastSuccessAt) })}`}
                  </p>
                  {device.lastFailureAt && device.lastError && (
                    <p className="text-xs break-words text-red-600 dark:text-red-400">
                      {t("push.lastFailed", { when: when(device.lastFailureAt), error: device.lastError })}
                    </p>
                  )}
                  {device.pending > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t("push.pending", { count: device.pending })}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("push.remove")}
                  aria-label={`${t("push.remove")}: ${device.label}`}
                  onClick={() => void remove(device)}
                  disabled={busy}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Message({ kind, text }: { kind: "error" | "info" | "success"; text: string }) {
  const Icon = kind === "error" ? CircleAlert : kind === "success" ? CircleCheck : Info;
  const color =
    kind === "error"
      ? "text-red-600 dark:text-red-400"
      : kind === "success"
        ? "text-green-700 dark:text-green-400"
        : "text-muted";
  return (
    <p className={`flex items-start gap-2 text-sm ${color}`}>
      <Icon className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}
