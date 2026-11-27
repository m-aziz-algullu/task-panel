"use client";

import { CircleAlert, CircleCheck, Download, LoaderCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { MAX_BACKUP_BYTES, parseBackup, summarizeBackup, type BackupSummary } from "@/lib/backup-shape";
import { formatDateTime } from "@/lib/dates";
import { announcedSize, downloadPercent, fileNameFromDisposition, readWithProgress, saveBlob } from "@/lib/download";

type Picked = { file: File; summary: BackupSummary };
type Status = { kind: "error"; message: MessageKey } | { kind: "restored"; summary: BackupSummary } | null;
/** preparing: the server is building the file; percent is null when the size is unknown. */
type Download =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "downloading"; percent: number | null }
  | { phase: "done" };

/** How long the button shows "Downloaded" before it can be used again. */
const DONE_MS = 2500;

export function BackupPanel({ timeZone }: { timeZone: string }) {
  const { t, intlLocale } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [download, setDownload] = useState<Download>({ phase: "idle" });
  const downloadAbort = useRef<AbortController | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const downloading = download.phase === "preparing" || download.phase === "downloading";

  // Leaving the page drops a half-read download and the pending reset.
  useEffect(
    () => () => {
      downloadAbort.current?.abort();
      clearTimeout(doneTimer.current);
    },
    [],
  );

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

  // Through fetch rather than a plain link, so the button can show that the
  // server is building the file, how much of it has arrived, and any error.
  const downloadBackup = async () => {
    if (downloading) return;
    clearTimeout(doneTimer.current);
    setStatus(null);
    setDownload({ phase: "preparing" });
    const abort = new AbortController();
    downloadAbort.current = abort;
    try {
      const response = await fetch("/api/backup", { signal: abort.signal, cache: "no-store" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: MessageKey } | null;
        throw new DownloadError(result?.error ?? "errors.generic");
      }
      const total = announcedSize(response.headers);
      setDownload({ phase: "downloading", percent: downloadPercent(0, total) });
      // One render per whole percent, not per chunk.
      let shown = downloadPercent(0, total);
      const blob = await readWithProgress(
        response,
        (received) => {
          const percent = downloadPercent(received, total);
          if (percent === shown) return;
          shown = percent;
          setDownload({ phase: "downloading", percent });
        },
        abort.signal,
      );
      saveBlob(blob, fileNameFromDisposition(response.headers.get("Content-Disposition"), "task-panel-backup.json"));
      setDownload({ phase: "done" });
      doneTimer.current = setTimeout(() => setDownload({ phase: "idle" }), DONE_MS);
    } catch (error) {
      if (abort.signal.aborted) return;
      setDownload({ phase: "idle" });
      setStatus({ kind: "error", message: error instanceof DownloadError ? error.key : "errors.backupDownloadFailed" });
    } finally {
      if (downloadAbort.current === abort) downloadAbort.current = null;
    }
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
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4" aria-labelledby="backup-title">
      <div>
        <h2 id="backup-title" className="text-sm font-semibold">
          {t("backup.title")}
        </h2>
        <p className="text-sm text-muted">{t("backup.hint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <DownloadButton state={download} onClick={() => void downloadBackup()} disabled={restoring} />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => input.current?.click()}
          disabled={restoring || downloading}
        >
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
            <CircleCheck className="mt-0.5 size-4 shrink-0" />{" "}
            {t("backup.restored", { counts: counts(status.summary) })}
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
                {restoring && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                {restoring ? t("backup.restoring") : t("backup.confirmButton")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

class DownloadError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}

function DownloadButton({ state, onClick, disabled }: { state: Download; onClick: () => void; disabled: boolean }) {
  const { t, intlLocale } = useI18n();
  const busy = state.phase === "preparing" || state.phase === "downloading";
  const percent = state.phase === "downloading" ? state.percent : null;

  let icon = <Download className="size-4" aria-hidden />;
  let label = t("backup.download");
  if (busy) {
    icon = <LoaderCircle className="size-4 animate-spin" aria-hidden />;
    label =
      state.phase === "preparing"
        ? t("backup.preparing")
        : percent === null
          ? t("backup.downloading")
          : t("backup.downloadingPercent", {
              percent: new Intl.NumberFormat(intlLocale, { style: "percent" }).format(percent / 100),
            });
  } else if (state.phase === "done") {
    icon = <CircleCheck className="size-4" aria-hidden />;
    label = t("backup.downloaded");
  }

  // Screen readers hear each phase once, not every percent.
  const announcement =
    state.phase === "preparing" ? t("backup.preparing") : state.phase === "done" ? t("backup.downloaded") : "";

  return (
    <>
      {/* aria-disabled instead of disabled while busy: the button keeps focus and
          stays at full colour, so the spinner reads as progress, not as "off". */}
      <button
        type="button"
        className={`btn relative min-w-48 justify-center overflow-hidden tabular-nums ${
          state.phase === "done" ? "bg-green-700 text-white dark:bg-green-500 dark:text-green-950" : "btn-primary"
        } ${busy ? "cursor-progress" : ""}`}
        onClick={onClick}
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        data-phase={state.phase}
      >
        {icon}
        <span>{label}</span>
        {busy && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-fg/20" aria-hidden>
            <span
              className={`block h-full bg-accent-fg/70 transition-[width] duration-200 ease-out ${
                percent === null
                  ? "w-1/3 animate-[download-indeterminate_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
                  : ""
              }`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
