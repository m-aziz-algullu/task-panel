import type { NextRequest } from "next/server";
import type { MessageKey } from "@/i18n/translate";
import { BackupError, exportBackup, restoreBackup } from "@/lib/backup";
import { MAX_BACKUP_BYTES, backupFileName, parseBackup } from "@/lib/backup-shape";
import { DOWNLOAD_SIZE_HEADER } from "@/lib/download";
import { getClock } from "@/lib/data";
import { getDb } from "@/lib/db";
import { readCapped, sameOrigin } from "@/lib/http";
import { InvalidDocumentError } from "@/lib/rich-text/document";
import { pokeRoutineScheduler } from "@/lib/routine-scheduler";
import { getCurrentUser } from "@/lib/session";

// Download and restore of the whole board. Route handlers rather than a Server
// Action: a backup can be far larger than a Server Action's body limit, and the
// download has to be a plain file response.

const noStore = { "Cache-Control": "no-store" };

function failure(error: MessageKey, status: number) {
  return Response.json({ ok: false, error }, { status, headers: noStore });
}

export async function GET() {
  if (!(await getCurrentUser())) return failure("errors.unauthorized", 401);
  const backup = await exportBackup(await getDb());
  const body = new TextEncoder().encode(JSON.stringify(backup, null, 2));
  return new Response(body, {
    headers: {
      ...noStore,
      "Content-Type": "application/json; charset=utf-8",
      // The settings page shows download progress from this (see lib/download.ts).
      [DOWNLOAD_SIZE_HEADER]: String(body.byteLength),
      "Content-Disposition": `attachment; filename="${backupFileName(getClock().today)}"`,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return failure("errors.invalid", 403);
  if (!(await getCurrentUser())) return failure("errors.unauthorized", 401);

  const text = await readCapped(request, MAX_BACKUP_BYTES);
  if (text === null) return failure("errors.backupTooLarge", 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failure("errors.backupInvalid", 400);
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) {
    if (parsed.detail) console.warn("[backup] rejected file:", parsed.detail);
    return failure(parsed.error, 400);
  }

  try {
    const summary = await restoreBackup(await getDb(), parsed.backup);
    pokeRoutineScheduler();
    console.info(`[backup] restored ${summary.tasks} tasks, ${summary.tags} tags, ${summary.routines} routines`);
    return Response.json({ ok: true, data: summary }, { headers: noStore });
  } catch (error) {
    if (error instanceof BackupError) return failure(error.error, 409);
    if (error instanceof InvalidDocumentError) {
      console.warn("[backup] rejected description:", error.message);
      return failure("errors.backupInvalid", 400);
    }
    console.error("[backup] restore failed:", error);
    return failure("errors.generic", 500);
  }
}
