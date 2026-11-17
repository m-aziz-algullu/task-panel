import "server-only";

import { asc, inArray, sql } from "drizzle-orm";
import type { MessageKey } from "@/i18n/translate";
import { getAgentSettings, saveAgentSettings } from "./agent/settings";
import { parseAgentSettings } from "./agent/settings-shape";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type BackupRoutine,
  type BackupSummary,
  type BackupTask,
  summarizeBackup,
} from "./backup-shape";
import { appTimeZone } from "./data";
import { schema, type Db } from "./db";
import { normalizeDocument, plainTextToDocument } from "./rich-text/document";
import { nextRunAt, parseSchedule } from "./routine-schedule";
import { ACTIVE_RUN_STATUSES } from "./types";

const { tags, tasks, taskTags, taskComments, routines, agentRuns } = schema;

/** Rows per INSERT, well under PostgreSQL's 65,535 bind parameters. */
const CHUNK = 500;

/** A restore that can't go ahead; `error` is a message key for the browser. */
export class BackupError extends Error {
  constructor(readonly error: MessageKey) {
    super(error);
  }
}

const iso = (value: Date | string) => new Date(value).toISOString();
/** `date` columns come back as YYYY-MM-DD, but some drivers hand over a Date. */
const day = (value: string | Date) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** Everything the user made, read in one snapshot so the parts agree with each other. */
export async function exportBackup(db: Db): Promise<Backup> {
  return db.transaction(
    async (tx) => {
      const [tagRows, taskRows, links, commentRows, routineRows, settings] = await Promise.all([
        tx.select().from(tags).orderBy(asc(tags.id)),
        tx.select().from(tasks).orderBy(asc(tasks.id)),
        tx.select().from(taskTags).orderBy(asc(taskTags.taskId), asc(taskTags.tagId)),
        tx.select().from(taskComments).orderBy(asc(taskComments.createdAt), asc(taskComments.id)),
        tx.select().from(routines).orderBy(asc(routines.id)),
        getAgentSettings(tx),
      ]);
      const tagIds = new Map<number, number[]>();
      for (const link of links) tagIds.set(link.taskId, [...(tagIds.get(link.taskId) ?? []), link.tagId]);
      const comments = new Map<number, BackupTask["comments"]>();
      for (const row of commentRows) {
        comments.set(row.taskId, [
          ...(comments.get(row.taskId) ?? []),
          { author: row.author as BackupTask["comments"][number]["author"], body: row.body, createdAt: iso(row.createdAt) },
        ]);
      }

      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          tags: tagRows.map((row) => ({ id: row.id, name: row.name, color: row.color, createdAt: iso(row.createdAt) })),
          tasks: taskRows.map(
            (row): BackupTask => ({
              id: row.id,
              title: row.title,
              // Descriptions from before the editor only have the plain text.
              descriptionDoc: row.descriptionDoc ?? plainTextToDocument(row.description),
              status: row.status as BackupTask["status"],
              storyPoints: row.storyPoints,
              day: day(row.day),
              dueDate: day(row.dueDate),
              position: row.position,
              createdAt: iso(row.createdAt),
              updatedAt: iso(row.updatedAt),
              completedAt: row.completedAt ? iso(row.completedAt) : null,
              tagIds: tagIds.get(row.id) ?? [],
              comments: comments.get(row.id) ?? [],
            }),
          ),
          routines: routineRows.map(
            (row): BackupRoutine => ({
              id: row.id,
              title: row.title,
              body: row.body,
              schedule: parseSchedule(row.schedule),
              handToAgent: row.handToAgent,
              lastRunAt: row.lastRunAt ? iso(row.lastRunAt) : null,
              createdAt: iso(row.createdAt),
              updatedAt: iso(row.updatedAt),
            }),
          ),
          agentSettings: settings,
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * Replaces the board with the backup's contents, all or nothing. Rows keep their
 * ids, so links between them (and the agent's auto tag) survive; sequences move
 * past the restored ids. Refuses while an agent run is queued or running, since
 * the worker would lose the task under it. Restored tasks don't start agent runs,
 * and routines resume at their next future occurrence.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<BackupSummary> {
  const { data } = backup;
  // Validate every description before touching the database; this throws InvalidDocumentError.
  const descriptions = new Map(data.tasks.map((task) => [task.id, normalizeDocument(task.descriptionDoc)]));
  const now = new Date();
  const timeZone = appTimeZone();

  await db.transaction(async (tx) => {
    // Taken up front and all at once: the routine scheduler and the agent worker
    // finish what they're doing first, and nothing new starts until this commits.
    // EXCLUSIVE still lets other requests read the board meanwhile.
    await tx.execute(
      sql`LOCK TABLE ${tags}, ${tasks}, ${taskTags}, ${taskComments}, ${routines}, ${agentRuns} IN EXCLUSIVE MODE`,
    );
    const [busy] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]))
      .limit(1);
    if (busy) throw new BackupError("errors.backupAgentBusy");

    // Cascades to task tags, comments and run history.
    await tx.delete(tasks);
    await tx.delete(tags);
    await tx.delete(routines);

    for (const rows of chunks(data.tags)) {
      await tx.insert(tags).values(
        rows.map((tag) => ({ id: tag.id, name: tag.name.trim(), color: tag.color, createdAt: new Date(tag.createdAt) })),
      );
    }
    for (const rows of chunks(data.tasks)) {
      await tx.insert(tasks).values(
        rows.map((task) => {
          const description = descriptions.get(task.id)!;
          return {
            id: task.id,
            title: task.title.trim(),
            description: description.text,
            descriptionDoc: description.doc,
            status: task.status,
            storyPoints: task.storyPoints,
            day: task.day,
            dueDate: task.dueDate,
            position: task.position,
            createdAt: new Date(task.createdAt),
            updatedAt: new Date(task.updatedAt),
            // Only done tasks carry a completion time, whatever the file says.
            completedAt: task.status === "done" ? new Date(task.completedAt ?? task.updatedAt) : null,
          };
        }),
      );
    }
    const links = data.tasks.flatMap((task) => [...new Set(task.tagIds)].map((tagId) => ({ taskId: task.id, tagId })));
    for (const rows of chunks(links)) await tx.insert(taskTags).values(rows);
    const comments = data.tasks.flatMap((task) =>
      task.comments.map((comment) => ({
        taskId: task.id,
        author: comment.author,
        body: comment.body,
        createdAt: new Date(comment.createdAt),
      })),
    );
    for (const rows of chunks(comments)) await tx.insert(taskComments).values(rows);
    for (const rows of chunks(data.routines)) {
      await tx.insert(routines).values(
        rows.map((routine) => ({
          id: routine.id,
          title: routine.title.trim(),
          body: routine.body.trim(),
          schedule: routine.schedule,
          handToAgent: routine.handToAgent,
          nextRunAt: routine.schedule ? nextRunAt(routine.schedule, now, timeZone) : null,
          lastRunAt: routine.lastRunAt ? new Date(routine.lastRunAt) : null,
          createdAt: new Date(routine.createdAt),
          updatedAt: new Date(routine.updatedAt),
        })),
      );
    }

    // New rows must not collide with the restored ids.
    for (const table of ["tags", "tasks", "task_comments", "routines"]) {
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${table}, 'id'), COALESCE((SELECT max(id) FROM ${sql.identifier(table)}), 0) + 1, false)`,
      );
    }

    if (data.agentSettings) {
      const settings = parseAgentSettings(data.agentSettings);
      const tagIds = new Set(data.tags.map((tag) => tag.id));
      if (settings.autoTagId !== null && !tagIds.has(settings.autoTagId)) settings.autoTagId = null;
      await saveAgentSettings(tx, settings);
    }
  });

  return summarizeBackup(backup);
}
