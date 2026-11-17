import type { NextRequest } from "next/server";
import type { MessageKey } from "@/i18n/translate";
import { BackupError, exportBackup, restoreBackup } from "@/lib/backup";
import { MAX_BACKUP_BYTES, backupFileName, parseBackup } from "@/lib/backup-shape";
import { getClock } from "@/lib/data";
import { getDb } from "@/lib/db";
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
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      ...noStore,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(getClock().today)}"`,
    },
  });
}

/**
 * The session cookie is SameSite=Lax, so another site can't POST with it; this
 * same-origin check is the second lock, the one Server Actions have built in.
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The body as text, or null once it passes the cap; never buffers more than that. */
async function readCapped(request: NextRequest): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BACKUP_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BACKUP_BYTES) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return failure("errors.invalid", 403);
  if (!(await getCurrentUser())) return failure("errors.unauthorized", 401);

  const text = await readCapped(request);
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
