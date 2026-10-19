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

/**
 * Beyond this a follow-up starts a new conversation. Every model call re-reads
 * the whole context, and once the prompt cache has expired (minutes after a run)
 * all of it is paid for again, so a one-line comment on a long run cost as much
 * as tens of thousands of tokens.
 */
export const MAX_CONTINUED_CONTEXT_TOKENS = 50_000;

/** What OpenClaw's session row says about its context: `totalTokens` is the current prompt's size. */
export type SessionContext = { totalTokens?: number | null; totalTokensFresh?: boolean | null };

/** Whether a follow-up carries on in this session; when its size is unknown, it does. */
export function continuesSession(session: SessionContext): boolean {
  if (session.totalTokensFresh === false || typeof session.totalTokens !== "number") return true;
  return session.totalTokens <= MAX_CONTINUED_CONTEXT_TOKENS;
}
