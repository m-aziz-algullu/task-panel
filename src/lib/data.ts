import "server-only";

import { connection } from "next/server";
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or, type SQL } from "drizzle-orm";
import { getDb, schema, type Db } from "./db";
import { DEFAULT_TIME_ZONE, addDays, dayKey, isDayKey, startOfDay } from "./dates";
import { requireSession } from "./session";
import { agentEnabled } from "./openclaw/connection";
import { ACTIVE_RUN_STATUSES, type Clock, type CommentAuthor, type RunStatus, type Status, type Tag, type Task, type TaskComment } from "./types";

const { tasks, tags, taskTags, taskComments, agentRuns } = schema;

export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function getClock(now = new Date()): Clock {
  const timeZone = appTimeZone();
  const today = dayKey(now, timeZone);
  return { today, timeZone, nextDayAt: startOfDay(addDays(today, 1), timeZone).getTime() };
}

type TaskRow = typeof tasks.$inferSelect;

export function toTask(row: TaskRow, tagIds: number[], timeZone: string, agentRun: RunStatus | null = null): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    descriptionDoc: row.descriptionDoc ?? null,
    status: row.status as Status,
    storyPoints: row.storyPoints,
    day: isDayKey(row.day) ? row.day : String(row.day).slice(0, 10),
    position: row.position,
    tagIds,
    createdAt: new Date(row.createdAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    completedDay: row.completedAt ? dayKey(new Date(row.completedAt), timeZone) : null,
    agentRun,
  };
}

async function tagIdsByTask(db: Db, taskIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
    .from(taskTags)
    .where(inArray(taskTags.taskId, taskIds));
  for (const { taskId, tagId } of rows) {
    map.set(taskId, [...(map.get(taskId) ?? []), tagId]);
  }
  return map;
}

/** Queued or running agent run per task. */
async function activeRunsByTask(db: Db, taskIds: number[]): Promise<Map<number, RunStatus>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ taskId: agentRuns.taskId, status: agentRuns.status })
    .from(agentRuns)
    .where(and(inArray(agentRuns.taskId, taskIds), inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES])));
  return new Map(rows.map((row) => [row.taskId, row.status as RunStatus]));
}

async function loadTasks(db: Db, where: SQL | undefined, order: SQL[], timeZone: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(...order);
  const ids = rows.map((r) => r.id);
  const [tagMap, runMap] = await Promise.all([tagIdsByTask(db, ids), activeRunsByTask(db, ids)]);
  return rows.map((row) => toTask(row, tagMap.get(row.id) ?? [], timeZone, runMap.get(row.id) ?? null));
}

export async function loadTask(db: Db, id: number): Promise<Task | null> {
  const [task] = await loadTasks(db, eq(tasks.id, id), [], appTimeZone());
  return task ?? null;
}

export function toComment(row: typeof taskComments.$inferSelect): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    author: row.author as CommentAuthor,
    body: row.body,
    runId: row.runId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** A task's comments, oldest first. */
export async function listComments(db: Db, taskId: number): Promise<TaskComment[]> {
  const rows = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id));
  return rows.map(toComment);
}

export async function listTags(db: Db): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .orderBy(asc(tags.name));
}

/** Session check plus a request-time anchor, since "today" depends on the clock. */
async function requestScope(): Promise<Clock> {
  await connection();
  await requireSession();
  return getClock();
}

/** Open tasks plus the tasks finished today; earlier finished ones live on /completed. */
export async function getBoardData() {
  const clock = await requestScope();
  const db = await getDb();
  const visible = or(ne(tasks.status, "done"), gte(tasks.completedAt, startOfDay(clock.today, clock.timeZone)));
  const [taskList, tagList] = await Promise.all([
    loadTasks(db, visible, [asc(tasks.position), desc(tasks.id)], clock.timeZone),
    listTags(db),
  ]);
  return { tasks: taskList, tags: tagList, clock, agent: agentEnabled() };
}

export async function getCompletedData() {
  const clock = await requestScope();
  const db = await getDb();
  const [taskList, tagList] = await Promise.all([
    loadTasks(
      db,
      and(eq(tasks.status, "done"), isNotNull(tasks.completedAt)),
      [desc(tasks.completedAt), desc(tasks.id)],
      clock.timeZone,
    ),
    listTags(db),
  ]);
  return { tasks: taskList, tags: tagList, clock, agent: agentEnabled() };
}
