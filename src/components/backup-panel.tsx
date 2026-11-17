"use client";

import { CircleAlert, CircleCheck, Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { MAX_BACKUP_BYTES, parseBackup, summarizeBackup, type BackupSummary } from "@/lib/backup-shape";
import { formatDateTime } from "@/lib/dates";

type Picked = { file: File; summary: BackupSummary };
type Status = { kind: "error"; message: MessageKey } | { kind: "restored"; summary: BackupSummary } | null;

export function BackupPanel({ timeZone }: { timeZone: string }) {
  const { t, intlLocale } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const counts = (summary: BackupSummary) =>
    [
      t("backup.tasks", { count: summary.tasks }),
      t("backup.tags", { count: summary.tags }),
      t("backup.routines", { count: summary.routines }),
    ].join(", ");

  // Read the file here first: a wrong file is caught before anything is sent,
  // and the confirmation can say what the backup holds.
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setStatus(null);
    if (file.size > MAX_BACKUP_BYTES) return setStatus({ kind: "error", message: "errors.backupTooLarge" });
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return setStatus({ kind: "error", message: "errors.backupInvalid" });
    }
    const parsed = parseBackup(raw);
    if (!parsed.ok) return setStatus({ kind: "error", message: parsed.error });
    setPicked({ file, summary: summarizeBackup(parsed.backup) });
  };

  const restore = async () => {
    if (!picked) return;
    setRestoring(true);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: picked.file,
      });
      const result = (await response.json().catch(() => null)) as
        | { ok: true; data: BackupSummary }
        | { ok: false; error: MessageKey }
        | null;
      if (result?.ok) {
        setStatus({ kind: "restored", summary: result.data });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result?.error ?? "errors.generic" });
      }
    } catch {
      setStatus({ kind: "error", message: "errors.generic" });
    } finally {
      setRestoring(false);
      setPicked(null);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("backup.title")}</h2>
        <p className="text-sm text-muted">{t("backup.hint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* A plain link: the browser streams the file straight to disk. */}
        <a href="/api/backup" download className="btn btn-primary">
          <Download className="size-4" /> {t("backup.download")}
        </a>
        <button type="button" className="btn btn-outline" onClick={() => input.current?.click()} disabled={restoring}>
          <Upload className="size-4" /> {t("backup.restore")}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label={t("backup.restore")}
          onChange={(event) => void pick(event.target.files?.[0])}
        />
      </div>
      <p className="text-xs text-muted">{t("backup.restoreHint")}</p>

      <div aria-live="polite">
        {status?.kind === "error" && (
          <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {t(status.message)}
          </p>
        )}
        {status?.kind === "restored" && (
          <p className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400">
            <CircleCheck className="mt-0.5 size-4 shrink-0" /> {t("backup.restored", { counts: counts(status.summary) })}
          </p>
        )}
      </div>

      {picked && (
        <Modal title={t("backup.confirmTitle")} onClose={() => !restoring && setPicked(null)}>
          <div className="flex flex-col gap-4 p-5 text-sm">
            <p>
              {t("backup.confirmFile", {
                date: formatDateTime(picked.summary.exportedAt, timeZone, intlLocale),
                counts: counts(picked.summary),
              })}
            </p>
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {t("backup.confirmWarning")}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setPicked(null)} disabled={restoring}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn bg-red-600 text-white hover:bg-red-700"
                onClick={() => void restore()}
                disabled={restoring}
              >
                {restoring ? t("backup.restoring") : t("backup.confirmButton")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
