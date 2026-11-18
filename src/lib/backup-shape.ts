// The backup file: everything the user made (tags, tasks with their tags and
// comments, routines, agent settings) as one JSON document. Pure, so the browser
// can read a file before uploading it and tests can check the rules.
//
// Left out on purpose: the account and sessions (a restore must not lock the user
// out or sign someone else in), the setup code, rate-limit rows, and agent run
// history, whose OpenClaw sessions only exist on the Gateway that ran them.

import { z } from "zod";
import { isHexColor } from "./colors";
import { isDayKey } from "./dates";
import { routineScheduleSchema } from "./routine-schedule";
import { COMMENT_AUTHORS, MAX_ROUTINE_BODY_LENGTH, STATUSES } from "./types";
import type { MessageKey } from "@/i18n/translate";

export const BACKUP_FORMAT = "task-panel-backup";
/** Bump when the shape changes, and keep reading the older versions. */
export const BACKUP_VERSION = 1;
/** Upload cap; a board with thousands of tasks and long descriptions stays well under it. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
/** Agent reports can run longer than what the comment box accepts. */
const MAX_BACKUP_COMMENT_LENGTH = 1_000_000;

const rowId = z.number().int().positive();
const timestamp = z.iso.datetime({ offset: true });
const dayKey = z.string().refine(isDayKey);

const tagSchema = z.object({
  id: rowId,
  name: z.string().trim().min(1).max(40),
  color: z.string().refine(isHexColor),
  createdAt: timestamp,
});

const commentSchema = z.object({
  author: z.enum(COMMENT_AUTHORS),
  body: z.string().min(1).max(MAX_BACKUP_COMMENT_LENGTH),
  createdAt: timestamp,
});

const taskSchema = z.object({
  id: rowId,
  title: z.string().trim().min(1).max(300),
  /** A TipTap document; the server validates it against the editor schema like any save. */
  descriptionDoc: z.unknown().nullable(),
  status: z.enum(STATUSES),
  storyPoints: z.number().int().min(0).max(1000).nullable(),
  day: dayKey,
  dueDate: dayKey,
  position: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp.nullable(),
  tagIds: z.array(rowId).max(50),
  comments: z.array(commentSchema),
});

const routineSchema = z.object({
  id: rowId,
  title: z.string().trim().min(1).max(300),
  body: z.string().max(MAX_ROUTINE_BODY_LENGTH),
  schedule: routineScheduleSchema.nullable(),
  handToAgent: z.boolean(),
  lastRunAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const dataSchema = z
  .object({
    tags: z.array(tagSchema),
    tasks: z.array(taskSchema),
    routines: z.array(routineSchema),
    /** Read leniently on restore, like the stored value: unknown or invalid fields fall back to defaults. */
    agentSettings: z.record(z.string(), z.unknown()).nullable(),
  })
  .superRefine((data, ctx) => {
    const duplicate = (values: (string | number)[]) => new Set(values).size !== values.length;
    if (duplicate(data.tags.map((tag) => tag.id))) ctx.addIssue({ code: "custom", message: "duplicate tag id" });
    if (duplicate(data.tags.map((tag) => tag.name.trim()))) ctx.addIssue({ code: "custom", message: "duplicate tag name" });
    if (duplicate(data.tasks.map((task) => task.id))) ctx.addIssue({ code: "custom", message: "duplicate task id" });
    if (duplicate(data.routines.map((routine) => routine.id))) ctx.addIssue({ code: "custom", message: "duplicate routine id" });
    const tagIds = new Set(data.tags.map((tag) => tag.id));
    if (data.tasks.some((task) => task.tagIds.some((id) => !tagIds.has(id)))) {
      ctx.addIssue({ code: "custom", message: "task refers to a missing tag" });
    }
  });

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: timestamp,
  data: dataSchema,
});

export type Backup = z.infer<typeof backupSchema>;
export type BackupTag = Backup["data"]["tags"][number];
export type BackupTask = Backup["data"]["tasks"][number];
export type BackupRoutine = Backup["data"]["routines"][number];

export type BackupSummary = { exportedAt: string; tags: number; tasks: number; routines: number };

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: MessageKey; detail?: string };

/** Checks a parsed JSON value. Errors are message keys, plus a detail for the logs. */
export function parseBackup(raw: unknown): ParsedBackup {
  const header = z.object({ format: z.literal(BACKUP_FORMAT), version: z.number().int() }).safeParse(raw);
  if (!header.success) return { ok: false, error: "errors.backupInvalid", detail: "not a Task Panel backup" };
  if (header.data.version > BACKUP_VERSION) return { ok: false, error: "errors.backupNewer" };

  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: "errors.backupInvalid", detail: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined };
  }
  return { ok: true, backup: parsed.data };
}

export function summarizeBackup(backup: Backup): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    tags: backup.data.tags.length,
    tasks: backup.data.tasks.length,
    routines: backup.data.routines.length,
  };
}

/** `task-panel-backup-2026-11-17.json`, dated by the caller's day. */
export function backupFileName(day: string): string {
  return `${BACKUP_FORMAT}-${day}.json`;
}
