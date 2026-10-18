import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { newSessionToken, sessionIdFromToken } from "../auth";
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
export async function latestRun(db: Db, taskId: number): Promise<AgentRun | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.id))
    .limit(1);
  return row ? toRun(row) : null;
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

/** Queues a run; null when the task already has one queued or running. */
export async function enqueueRun(
  db: Db,
  taskId: number,
  input: AgentRunInput,
  trigger: AgentRun["trigger"],
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
      sessionKey: newSessionKey(taskId),
    })
    // The partial unique index allows one active run per task.
    .onConflictDoNothing()
    .returning();
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * Takes the oldest queued run and marks it running with a fresh API token for the
 * agent. Only the token's hash is stored; the raw token goes into the run's prompt.
 */
export async function claimNextRun(db: Db): Promise<{ row: RunRow; token: string } | null> {
  const token = newSessionToken();
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE agent_runs SET status = 'running', started_at = now(), token_hash = ${sessionIdFromToken(token)}
    WHERE id = (
      SELECT id FROM agent_runs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = (Array.isArray(rows) ? rows : (rows as { rows: { id: number }[] }).rows)[0]?.id;
  if (id == null) return null;
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row ? { row, token } : null;
}

function newSessionKey(taskId: number): string {
  return `${AGENT_SESSION_KEY_PREFIX}task-${taskId}:${randomUUID()}`;
}

/**
 * Puts a claimed run back in the queue, e.g. while the Gateway is restarting. A
 * fresh session key, since an interrupted attempt may have created the old session.
 */
export async function requeueRun(db: Db, run: Pick<RunRow, "id" | "taskId">): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: "queued", startedAt: null, tokenHash: null, sessionKey: newSessionKey(run.taskId) })
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
  values: Partial<Pick<RunRow, "openclawRunId" | "tokensUsed">>,
): Promise<void> {
  await db.update(agentRuns).set(values).where(eq(agentRuns.id, runId));
}

/** The running run an agent API token belongs to; null once the run has ended. */
export async function runForToken(db: Db, token: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.tokenHash, sessionIdFromToken(token)), eq(agentRuns.status, "running")));
  return row ?? null;
}

export async function addRunComment(db: Db, run: Pick<RunRow, "id" | "taskId">, author: CommentAuthor, body: string) {
  await db.insert(taskComments).values({ taskId: run.taskId, runId: run.id, author, body });
}

/**
 * Ends a queued or running run, once: the agent's finish call, a budget stop, a
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
        // The token dies with the run.
        tokenHash: null,
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
