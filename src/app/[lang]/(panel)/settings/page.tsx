import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { BackupPanel } from "@/components/backup-panel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { getI18n } from "@/i18n/server";
import { appTimeZone } from "@/lib/data";
import { getDb } from "@/lib/db";
import { listPushDevices } from "@/lib/push/subscriptions";
import { VapidConfigError, getVapidKeys } from "@/lib/push/vapid";
import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.settings") };
}

/** The VAPID public key, or null (and the reason in the logs) when the env sets it wrong. */
async function pushPublicKey(): Promise<string | null> {
  try {
    return (await getVapidKeys(await getDb())).publicKey;
  } catch (error) {
    if (!(error instanceof VapidConfigError)) throw error;
    console.error(`[push] ${error.message}`);
    return null;
  }
}

async function SettingsData() {
  await connection();
  await requireSession();
  const [devices, publicKey] = await Promise.all([getDb().then(listPushDevices), pushPublicKey()]);
  const timeZone = appTimeZone();
  return (
    <>
      <NotificationsPanel devices={devices} publicKey={publicKey} timeZone={timeZone} />
      <BackupPanel timeZone={timeZone} />
    </>
  );
}

export default async function SettingsPage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Settings className="size-5 text-accent" /> {t("settings.title")}
        </h1>
        <p className="text-sm text-muted">{t("settings.subtitle")}</p>
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border border-border" />}>
        <SettingsData />
      </Suspense>
    </div>
  );
}
