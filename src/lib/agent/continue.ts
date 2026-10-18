import "server-only";

import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { agentEnabled } from "../openclaw/connection";
import type { LimitMode, RunStatus, Status } from "../types";
import { commentContinuation, followUpInput } from "./continuation";
import { enqueueRun, latestRunRow } from "./runs";
import { pokeAgentWorker } from "./worker";

const { tasks } = schema;

/**
 * Called after the user comments on a task. If the agent has worked on it, the
 * comment continues their conversation: a new turn in the same session with the
 * last run's settings. While a run is queued or running nothing happens yet;
 * the worker carries on once that run ends. Returns whether a turn was queued.
 */
export async function continueFromComment(db: Db, taskId: number): Promise<boolean> {
  const [task] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId));
  if (!task) return false;
  const latest = await latestRunRow(db, taskId);
  const action = commentContinuation({
    agentEnabled: agentEnabled(),
    taskStatus: task.status as Status,
    latestRunStatus: (latest?.status as RunStatus | undefined) ?? null,
  });
  if (action !== "now" || !latest) return false;
  const run = await enqueueRun(
    db,
    taskId,
    followUpInput({ ...latest, limitMode: latest.limitMode as LimitMode }),
    "comment",
    latest,
  );
  if (run) pokeAgentWorker();
  return run != null;
}
