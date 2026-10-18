import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
import { moveTaskTo } from "../task-status";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_SESSION_KEY_PREFIX,
  type AgentRun,
  type AgentRunInput,
  type CommentAuthor,
  type LimitMode,
  type RunStatus,
  type Status,
} from "../types";

const { agentRuns, taskComments } = schema;

export type RunRow = typeof agentRuns.$inferSelect;

export function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status as RunStatus,
    trigger: row.trigger as AgentRun["trigger"],
    agentId: row.agentId,
    model: row.model,
    thinking: row.thinking,
    timeoutSeconds: row.timeoutSeconds,
    tokenLimit: row.tokenLimit,
    limitMode: row.limitMode as LimitMode,
    tokensUsed: row.tokensUsed,
    error: row.error,
    createdAt: new Date(row.createdAt).toISOString(),
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  };
}

const isActive = inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]);

/** The task's newest run, finished or not. */
export async function latestRunRow(db: Db, taskId: number): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.id))
    .limit(1);
  return row ?? null;
}

export async function latestRun(db: Db, taskId: number): Promise<AgentRun | null> {
  const row = await latestRunRow(db, taskId);
  return row ? toRun(row) : null;
}

export async function runById(db: Db, runId: number): Promise<RunRow | null> {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  return row ?? null;
}

export async function activeRun(db: Db, taskId: number): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), isActive));
  return row ?? null;
}

/** Queued or running run status per task, for the board's cards. */
export async function activeRunStatuses(db: Db, taskIds: number[]): Promise<Map<number, RunStatus>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ taskId: agentRuns.taskId, status: agentRuns.status })
    .from(agentRuns)
    .where(and(inArray(agentRuns.taskId, taskIds), isActive));
  return new Map(rows.map((row) => [row.taskId, row.status as RunStatus]));
}

/**
 * Queues a run; null when the task already has one queued or running. With
 * `continues`, the run carries on that run's OpenClaw conversation (same session).
 */
export async function enqueueRun(
  db: Db,
  taskId: number,
  input: AgentRunInput,
  trigger: AgentRun["trigger"],
  continues?: Pick<RunRow, "id" | "sessionKey">,
): Promise<AgentRun | null> {
  const rows = await db
    .insert(agentRuns)
    .values({
      taskId,
      status: "queued",
      trigger,
      agentId: input.agentId,
      model: input.model,
      thinking: input.thinking,
      timeoutSeconds: input.timeoutSeconds,
      tokenLimit: input.tokenLimit,
      limitMode: input.limitMode,
      sessionKey: continues?.sessionKey ?? newSessionKey(taskId),
      continuesRunId: continues?.id ?? null,
    })
    // The partial unique index allows one active run per task.
    .onConflictDoNothing()
    .returning();
  return rows[0] ? toRun(rows[0]) : null;
}

/** Takes the oldest queued run and marks it running. */
export async function claimNextRun(db: Db): Promise<RunRow | null> {
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE agent_runs SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM agent_runs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = (Array.isArray(rows) ? rows : (rows as { rows: { id: number }[] }).rows)[0]?.id;
  if (id == null) return null;
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row ?? null;
}

export function newSessionKey(taskId: number): string {
  return `${AGENT_SESSION_KEY_PREFIX}task-${taskId}:${randomUUID()}`;
}

/**
 * Puts a claimed run back in the queue, e.g. while the Gateway is restarting. A
 * new run gets a fresh session key, since an interrupted attempt may have created
 * the old session; a follow-up keeps its conversation's key.
 */
export async function requeueRun(
  db: Db,
  run: Pick<RunRow, "id" | "taskId" | "continuesRunId">,
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: "queued",
      startedAt: null,
      ...(run.continuesRunId ? {} : { sessionKey: newSessionKey(run.taskId) }),
    })
    .where(and(eq(agentRuns.id, run.id), eq(agentRuns.status, "running")));
}

export async function runningRuns(db: Db): Promise<RunRow[]> {
  return db.select().from(agentRuns).where(eq(agentRuns.status, "running")).orderBy(asc(agentRuns.id));
}

export async function runStatus(db: Db, runId: number): Promise<RunStatus | null> {
  const [row] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId));
  return (row?.status as RunStatus | undefined) ?? null;
}

export async function updateRun(
  db: Db,
  runId: number,
  values: Partial<Pick<RunRow, "openclawRunId" | "tokensUsed" | "usageBaseline" | "sessionKey" | "continuesRunId">>,
): Promise<void> {
  await db.update(agentRuns).set(values).where(eq(agentRuns.id, runId));
}

/** How many comments the user wrote on the task after `since`. */
export async function userCommentsSince(db: Db, taskId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(taskComments)
    .where(and(eq(taskComments.taskId, taskId), eq(taskComments.author, "user"), gt(taskComments.createdAt, since)));
  return row?.value ?? 0;
}

export async function addRunComment(db: Db, run: Pick<RunRow, "id" | "taskId">, author: CommentAuthor, body: string) {
  await db.insert(taskComments).values({ taskId: run.taskId, runId: run.id, author, body });
}

/**
 * Ends a queued or running run, once: the agent's report, a budget stop, a
 * failure and the user's stop button can race, and only the first one counts.
 * Writes the run's closing comment and moves the task. Returns false if the run
 * had already ended.
 */
export async function finalizeRun(
  db: Db,
  run: Pick<RunRow, "id" | "taskId">,
  outcome: {
    status: Exclude<RunStatus, "queued" | "running">;
    error?: string | null;
    tokensUsed?: number;
    comment?: { author: CommentAuthor; body: string };
    moveTo?: Status;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const ended = await tx
      .update(agentRuns)
      .set({
        status: outcome.status,
        error: outcome.error ?? null,
        finishedAt: new Date(),
        ...(outcome.tokensUsed != null ? { tokensUsed: outcome.tokensUsed } : {}),
      })
      .where(and(eq(agentRuns.id, run.id), isActive))
      .returning({ id: agentRuns.id });
    if (ended.length === 0) return false;
    if (outcome.comment) await addRunComment(tx, run, outcome.comment.author, outcome.comment.body);
    if (outcome.moveTo) await moveTaskTo(tx, run.taskId, outcome.moveTo);
    return true;
  });
}
