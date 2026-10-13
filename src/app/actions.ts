"use server";

import { and, eq, inArray, min, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { isHexColor } from "@/lib/colors";
import { getDb, schema, type Db } from "@/lib/db";
import { loadTask } from "@/lib/data";
import { isDayKey } from "@/lib/dates";
import { InvalidDocumentError, normalizeDocument } from "@/lib/rich-text/document";
import { requireSession } from "@/lib/session";
import { STATUSES, type Status, type Tag, type TagInput, type Task, type TaskInput } from "@/lib/types";
import type { MessageKey } from "@/i18n/translate";

const { tasks, tags, taskTags } = schema;

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
  tagIds: z.array(id).max(50),
});

const tagInput = z.object({
  name: z.string().trim().min(1, msg("errors.tagNameRequired")).max(40, msg("errors.tagNameTooLong")),
  color: z.string().refine(isHexColor, msg("errors.colorInvalid")),
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

/** Position that puts a task on top of `status`'s column. */
async function topPosition(db: Db, status: Status): Promise<number> {
  const [row] = await db
    .select({ value: min(tasks.position) })
    .from(tasks)
    .where(eq(tasks.status, status));
  return row?.value == null ? 0 : row.value - 1;
}

async function setTags(db: Db, taskId: number, tagIds: number[]) {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const existing = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique));
  if (existing.length === 0) return;
  await db.insert(taskTags).values(existing.map((t) => ({ taskId, tagId: t.id })));
}

/** completed_at follows the status: stamped on entering Done, cleared on leaving it. */
function completedAtFor(next: Status, previous: { status: string; completedAt: Date | null } | null) {
  if (next !== "done") return null;
  if (previous?.status === "done" && previous.completedAt) return previous.completedAt;
  return new Date();
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
          completedAt: completedAtFor(input.status, null),
        })
        .returning({ id: tasks.id });
      await setTags(tx, row.id, input.tagIds);
      return row.id;
    });
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
          completedAt: completedAtFor(input.status, current),
          updatedAt: new Date(),
          ...(statusChanged ? { position: await topPosition(tx, input.status) } : {}),
        })
        .where(eq(tasks.id, taskId));
      await setTags(tx, taskId, input.tagIds);
      return true;
    });
    if (!found) return { ok: false, error: "errors.taskNotFound" };
    const task = await loadTask(db, taskId);
    refresh();
    return { ok: true, data: task! };
  } catch (error) {
    return fail(error);
  }
}

/** Moves a task to `status` and stores that column's order as given. */
export async function moveTask(rawId: number, rawStatus: Status, rawOrder: number[]): Promise<ActionResult> {
  await requireSession();
  try {
    const taskId = id.parse(rawId);
    const status = z.enum(STATUSES).parse(rawStatus);
    const order = z.array(id).max(5000).parse(rawOrder);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!current) return;
      await tx
        .update(tasks)
        .set({ status, completedAt: completedAtFor(status, current), updatedAt: new Date() })
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
