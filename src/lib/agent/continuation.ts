// When a task's conversation with the agent goes on. Pure, so it can be tested.

import type { AgentRunInput, RunStatus, Status } from "../types";

/**
 * What a new comment from the user does: nothing (no agent, never handed to the
 * agent, or already done), nothing yet (a run is queued or running; it gets
 * picked up when that run ends), or a new turn right away.
 */
export function commentContinuation({
  agentEnabled,
  taskStatus,
  latestRunStatus,
}: {
  agentEnabled: boolean;
  taskStatus: Status;
  latestRunStatus: RunStatus | null;
}): "none" | "later" | "now" {
  if (!agentEnabled || latestRunStatus == null || taskStatus === "done") return "none";
  if (latestRunStatus === "queued" || latestRunStatus === "running") return "later";
  return "now";
}

/**
 * After a run ends: the user commented while it ran, so the conversation goes
 * on. Not after the user stopped it, and not once the task is done.
 */
export function continuesAfterRun({
  runStatus,
  taskStatus,
  userCommentsSinceStart,
}: {
  runStatus: RunStatus;
  taskStatus: Status;
  userCommentsSinceStart: number;
}): boolean {
  return runStatus !== "aborted" && taskStatus !== "done" && userCommentsSinceStart > 0;
}

/** A follow-up keeps the settings of the run it continues. */
export function followUpInput(run: AgentRunInput): AgentRunInput {
  return {
    agentId: run.agentId,
    model: run.model,
    thinking: run.thinking,
    timeoutSeconds: run.timeoutSeconds,
    tokenLimit: run.tokenLimit,
    limitMode: run.limitMode,
  };
}

/** Tokens a run spent: the session's total now, minus what it had when the run started. */
export function runTokens(sessionTotal: number, baseline: number): number {
  return Math.max(0, sessionTotal - baseline);
}
