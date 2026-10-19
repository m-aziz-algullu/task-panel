"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { isHexColor } from "@/lib/colors";
import { getDb, schema, type Db } from "@/lib/db";
import { syncAgentTag } from "@/lib/agent/auto";
import { continueFromComment } from "@/lib/agent/continue";
import { activeRun, enqueueRun, finalizeRun, latestRunRow } from "@/lib/agent/runs";
import { MAX_TIMEOUT_SECONDS, MAX_TOKEN_LIMIT, MIN_TOKEN_LIMIT } from "@/lib/agent/settings-shape";
import { systemCommentBody } from "@/lib/agent/system-comments";
import { abortSession, pokeAgentWorker } from "@/lib/agent/worker";
import { getClock, loadTask, toComment } from "@/lib/data";
import { isDayKey } from "@/lib/dates";
import { agentEnabled } from "@/lib/openclaw/connection";
import { InvalidDocumentError, normalizeDocument } from "@/lib/rich-text/document";
import { requireSession } from "@/lib/session";
import { completedAtFor, topPosition } from "@/lib/task-status";
import {
  LIMIT_MODES,
  MAX_COMMENT_LENGTH,
  MAX_ROUTINE_BODY_LENGTH,
  STATUSES,
  type AgentRun,
  type AgentRunInput,
  type Routine,
  type RoutineInput,
  type Status,
  type Tag,
  type TagInput,
  type Task,
  type TaskComment,
  type TaskInput,
} from "@/lib/types";
import type { MessageKey } from "@/i18n/translate";

const { tasks, tags, taskTags, taskComments, routines } = schema;

/** Errors are message keys; the browser translates them into the viewer's language. */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: MessageKey };

const msg = (key: MessageKey) => key;

const id = z.number().int().positive();

const taskInput = z.object({
  title: z.string().trim().min(1, msg("errors.titleRequired")).max(300, msg("errors.titleTooLong")),
  descriptionDoc: z.unknown(),
  status: z.enum(STATUSES),
  storyPoints: z.number().int().min(0).max(1000).nullable(),
  day: z.string().refine(isDayKey, msg("errors.dayInvalid")),
  completedDay: z
    .string()
    .refine((value) => isDayKey(value) && value <= getClock().today, msg("errors.dayInvalid"))
    .optional(),
  tagIds: z.array(id).max(50),
});

const commentBody = z
  .string()
  .trim()
  .min(1, msg("errors.commentRequired"))
  .max(MAX_COMMENT_LENGTH, msg("errors.commentTooLong"));

const optionalName = z.string().trim().min(1).max(200).nullable();

const agentRunInput = z.object({
  agentId: optionalName,
  model: optionalName,
  thinking: optionalName,
  timeoutSeconds: z.number().int().min(60, msg("errors.timeoutInvalid")).max(MAX_TIMEOUT_SECONDS, msg("errors.timeoutInvalid")),
  tokenLimit: z
    .number()
    .int()
    .min(MIN_TOKEN_LIMIT, msg("errors.tokenLimitInvalid"))
    .max(MAX_TOKEN_LIMIT, msg("errors.tokenLimitInvalid")),
  limitMode: z.enum(LIMIT_MODES),
});

const tagInput = z.object({
  name: z.string().trim().min(1, msg("errors.tagNameRequired")).max(40, msg("errors.tagNameTooLong")),
  color: z.string().refine(isHexColor, msg("errors.colorInvalid")),
});

const routineInput = z.object({
  title: z.string().trim().min(1, msg("errors.titleRequired")).max(300, msg("errors.titleTooLong")),
  body: z.string().trim().max(MAX_ROUTINE_BODY_LENGTH, msg("errors.routineTooLong")),
});

function fail(error: unknown): { ok: false; error: MessageKey } {
  if (error instanceof z.ZodError) {
    // Custom messages above are keys; anything else (type errors etc.) is a generic "invalid".
    const message = error.issues[0]?.message ?? "";
    return { ok: false, error: message.startsWith("errors.") ? (message as MessageKey) : "errors.invalid" };
  }
  if (error instanceof InvalidDocumentError) {
    console.warn("[task] rejected description:", error.message);
    return { ok: false, error: "errors.descriptionInvalid" };
  }
  console.error(error);
  return { ok: false, error: "errors.generic" };
}

async function setTags(db: Db, taskId: number, tagIds: number[]) {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const existing = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique));
  if (existing.length === 0) return;
  await db.insert(taskTags).values(existing.map((t) => ({ taskId, tagId: t.id })));
}

export async function createTask(raw: TaskInput): Promise<ActionResult<Task>> {
  await requireSession();
  try {
    const input = taskInput.parse(raw);
    const description = normalizeDocument(input.descriptionDoc);
    const db = await getDb();
    const taskId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tasks)
        .values({
          title: input.title,
          description: description.text,
          descriptionDoc: description.doc,
          status: input.status,
          storyPoints: input.storyPoints,
          day: input.day,
          position: await topPosition(tx, input.status),
          completedAt: completedAtFor(input.status, null, input.completedDay),
        })
        .returning({ id: tasks.id });
      await setTags(tx, row.id, input.tagIds);
      return row.id;
    });
    await syncAgentTag(db, { id: taskId, status: input.status }, [], input.tagIds);
    const task = await loadTask(db, taskId);
    refresh();
    return { ok: true, data: task! };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTask(rawId: number, raw: TaskInput): Promise<ActionResult<Task>> {
  await requireSession();
  try {
    const taskId = id.parse(rawId);
    const input = taskInput.parse(raw);
    const description = normalizeDocument(input.descriptionDoc);
    const db = await getDb();
    const previousTagIds = await db
      .select({ tagId: taskTags.tagId })
      .from(taskTags)
      .where(eq(taskTags.taskId, taskId))
      .then((rows) => rows.map((row) => row.tagId));
    const found = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!current) return false;
      const statusChanged = current.status !== input.status;
      await tx
        .update(tasks)
        .set({
          title: input.title,
          description: description.text,
          descriptionDoc: description.doc,
          status: input.status,
          storyPoints: input.storyPoints,
          day: input.day,
          completedAt: completedAtFor(input.status, current, input.completedDay),
          updatedAt: new Date(),
          ...(statusChanged ? { position: await topPosition(tx, input.status) } : {}),
        })
        .where(eq(tasks.id, taskId));
      await setTags(tx, taskId, input.tagIds);
      return true;
    });
    if (!found) return { ok: false, error: "errors.taskNotFound" };
    await syncAgentTag(db, { id: taskId, status: input.status }, previousTagIds, input.tagIds);
    const task = await loadTask(db, taskId);
    refresh();
    return { ok: true, data: task! };
  } catch (error) {
    return fail(error);
  }
}

/** Moves a task to `status` and stores that column's order as given. */
const moveResolution = z
  .object({
    /** Re-plan the task onto this day. */
    day: taskInput.shape.day.optional(),
    /** Record the completion on this (past or current) day. */
    completedDay: taskInput.shape.completedDay,
  })
  .optional();

export async function moveTask(
  rawId: number,
  rawStatus: Status,
  rawOrder: number[],
  rawResolution?: { day?: string; completedDay?: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    const taskId = id.parse(rawId);
    const status = z.enum(STATUSES).parse(rawStatus);
    const order = z.array(id).max(5000).parse(rawOrder);
    const resolution = moveResolution.parse(rawResolution);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!current) return;
      await tx
        .update(tasks)
        .set({
          status,
          completedAt: completedAtFor(status, current, resolution?.completedDay),
          ...(resolution?.day ? { day: resolution.day } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      for (const [index, orderedId] of order.entries()) {
        await tx
          .update(tasks)
          .set({ position: index })
          .where(and(eq(tasks.id, orderedId), eq(tasks.status, status)));
      }
    });
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteTask(rawId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const db = await getDb();
    await db.delete(tasks).where(eq(tasks.id, id.parse(rawId)));
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function addComment(rawTaskId: number, rawBody: string): Promise<ActionResult<TaskComment>> {
  await requireSession();
  try {
    const taskId = id.parse(rawTaskId);
    const body = commentBody.parse(rawBody);
    const db = await getDb();
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId));
    if (!task) return { ok: false, error: "errors.taskNotFound" };
    const [row] = await db.insert(taskComments).values({ taskId, author: "user", body }).returning();
    // On a task the agent has worked on, the comment carries the conversation on.
    if (await continueFromComment(db, taskId)) refresh();
    return { ok: true, data: toComment(row) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteComment(rawId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const db = await getDb();
    await db.delete(taskComments).where(eq(taskComments.id, id.parse(rawId)));
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Hands a task to the agent: queues a run that the worker starts as soon as there's
 * room. If the agent has worked on the task before, the run continues that
 * conversation unless `fresh` asks for a new one.
 */
export async function startAgentRun(
  rawTaskId: number,
  raw: AgentRunInput,
  fresh = false,
): Promise<ActionResult<AgentRun>> {
  await requireSession();
  try {
    const taskId = id.parse(rawTaskId);
    const input = agentRunInput.parse(raw);
    if (!agentEnabled()) return { ok: false, error: "errors.agentUnavailable" };
    const db = await getDb();
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId));
    if (!task) return { ok: false, error: "errors.taskNotFound" };
    const previous = fresh ? null : await latestRunRow(db, taskId);
    const run = await enqueueRun(db, taskId, input, "manual", previous ?? undefined);
    if (!run) return { ok: false, error: "errors.agentRunActive" };
    pokeAgentWorker();
    refresh();
    return { ok: true, data: run };
  } catch (error) {
    return fail(error);
  }
}

/** Stops the task's queued or running agent run. */
export async function stopAgentRun(rawTaskId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const db = await getDb();
    const run = await activeRun(db, id.parse(rawTaskId));
    if (run) {
      const ended = await finalizeRun(db, run, {
        status: "aborted",
        comment: { author: "system", body: systemCommentBody("agentRun.systemAborted") },
      });
      if (ended && run.status === "running") await abortSession(run);
    }
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

async function nameTaken(db: Db, name: string, exceptId?: number): Promise<boolean> {
  const sameName = sql`lower(${tags.name}) = lower(${name})`;
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(exceptId ? and(sameName, ne(tags.id, exceptId)) : sameName);
  return rows.length > 0;
}

export async function createTag(raw: TagInput): Promise<ActionResult<Tag>> {
  await requireSession();
  try {
    const input = tagInput.parse(raw);
    const db = await getDb();
    if (await nameTaken(db, input.name)) return { ok: false, error: "errors.tagExists" };
    const [tag] = await db
      .insert(tags)
      .values({ name: input.name, color: input.color.toLowerCase() })
      .returning({ id: tags.id, name: tags.name, color: tags.color });
    refresh();
    return { ok: true, data: tag };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTag(rawId: number, raw: TagInput): Promise<ActionResult<Tag>> {
  await requireSession();
  try {
    const tagId = id.parse(rawId);
    const input = tagInput.parse(raw);
    const db = await getDb();
    if (await nameTaken(db, input.name, tagId)) return { ok: false, error: "errors.tagExists" };
    const [tag] = await db
      .update(tags)
      .set({ name: input.name, color: input.color.toLowerCase() })
      .where(eq(tags.id, tagId))
      .returning({ id: tags.id, name: tags.name, color: tags.color });
    if (!tag) return { ok: false, error: "errors.tagNotFound" };
    refresh();
    return { ok: true, data: tag };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteTag(rawId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const db = await getDb();
    await db.delete(tags).where(eq(tags.id, id.parse(rawId)));
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

const routineColumns = { id: routines.id, title: routines.title, body: routines.body };

export async function createRoutine(raw: RoutineInput): Promise<ActionResult<Routine>> {
  await requireSession();
  try {
    const input = routineInput.parse(raw);
    const db = await getDb();
    const [routine] = await db.insert(routines).values(input).returning(routineColumns);
    refresh();
    return { ok: true, data: routine };
  } catch (error) {
    return fail(error);
  }
}

export async function updateRoutine(rawId: number, raw: RoutineInput): Promise<ActionResult<Routine>> {
  await requireSession();
  try {
    const routineId = id.parse(rawId);
    const input = routineInput.parse(raw);
    const db = await getDb();
    const [routine] = await db
      .update(routines)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(routines.id, routineId))
      .returning(routineColumns);
    if (!routine) return { ok: false, error: "errors.routineNotFound" };
    refresh();
    return { ok: true, data: routine };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRoutine(rawId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const db = await getDb();
    await db.delete(routines).where(eq(routines.id, id.parse(rawId)));
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
