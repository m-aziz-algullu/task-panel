import "server-only";

import { inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { listComments, loadTask } from "../data";
import { GatewayUnavailableError, gatewayRequest } from "../openclaw/client";
import { gatewayConnection } from "../openclaw/connection";
import { moveTaskTo } from "../task-status";
import type { LimitMode, RunStatus, Task } from "../types";
import { continuesAfterRun, followUpInput, runTokens } from "./continuation";
import { buildFollowUpPrompt, buildRunPrompt, parseRunReport } from "./prompt";
import { errorText, turnReply } from "./reply";
import {
  claimNextRun,
  enqueueRun,
  finalizeRun,
  newSessionKey,
  requeueRun,
  runById,
  runStatus,
  runningRuns,
  updateRun,
  userCommentsSince,
  type RunRow,
} from "./runs";
import { getAgentSettings } from "./settings";
import type { AgentSettings } from "./settings-shape";
import { systemCommentBody } from "./system-comments";

const { tags } = schema;

const TICK_MS = 5_000;
/** How long one agent.wait call blocks before the watcher checks usage and deadlines again. */
const WAIT_SLICE_MS = 10_000;
/** OpenClaw's own turn timeout gets a little head start before Task Panel steps in. */
const DEADLINE_GRACE_MS = 60_000;

type WaitResult = { status?: string; error?: unknown; message?: string };
type TurnStarted = { runId?: string; runStarted?: boolean; runError?: { message?: string } };

/** The conversation a follow-up was meant to continue doesn't exist (anymore). */
class SessionMissingError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The OpenClaw session's token total so far; null before anything is recorded. */
async function sessionTokens(sessionKey: string): Promise<number | null> {
  try {
    const usage = await gatewayRequest<{ totals?: { totalTokens?: number } }>("sessions.usage", { key: sessionKey });
    return usage.totals?.totalTokens ?? null;
  } catch {
    // Not recorded yet right after the session starts.
    return null;
  }
}

/** Stops the run's OpenClaw session; best effort, the run is ended in Task Panel either way. */
export async function abortSession(run: RunRow): Promise<void> {
  try {
    await gatewayRequest("sessions.abort", {
      key: run.sessionKey,
      ...(run.openclawRunId ? { runId: run.openclawRunId } : {}),
      ...(run.agentId ? { agentId: run.agentId } : {}),
      clearQueued: true,
    });
  } catch (error) {
    console.warn(`[agent] Could not abort run ${run.id}:`, errorText(error));
  }
}

/** The agent's final message: its report on the task. */
function finalReply(run: RunRow, result: unknown): Promise<string | null> {
  return turnReply({ runId: run.openclawRunId, sessionKey: run.sessionKey, agentId: run.agentId, result });
}

function failure(reason: string) {
  return {
    status: "failed" as const,
    error: reason,
    comment: { author: "system" as const, body: systemCommentBody("agentRun.systemFailed", { error: reason }) },
  };
}

class AgentWorker {
  private watching = new Set<number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  /** Picks up new work right away instead of on the next tick. */
  poke() {
    void this.tick();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const db = await getDb();
      const settings = await getAgentSettings(db);
      const running = await runningRuns(db);
      // Runs left running by an earlier process (a restart or deploy): watch them again.
      for (const row of running) {
        if (this.watching.has(row.id)) continue;
        if (row.openclawRunId) this.track(db, row.id, () => this.watch(db, row));
        else await requeueRun(db, row);
      }
      let free = settings.concurrency - running.length;
      while (free-- > 0) {
        const claimed = await claimNextRun(db);
        if (!claimed) break;
        this.track(db, claimed.id, () => this.dispatch(db, claimed));
      }
    } catch (error) {
      console.error("[agent] Worker tick failed:", error);
    } finally {
      this.ticking = false;
    }
  }

  private track(db: Db, runId: number, work: () => Promise<void>) {
    this.watching.add(runId);
    work()
      .then(() => this.continueAfter(db, runId))
      .catch((error) => console.error(`[agent] Run ${runId} failed:`, error))
      .finally(() => {
        this.watching.delete(runId);
        this.poke();
      });
  }

  /** The user commented while the run worked: carry the conversation on with them. */
  private async continueAfter(db: Db, runId: number) {
    const run = await runById(db, runId);
    if (!run?.startedAt || run.status === "queued" || run.status === "running") return;
    const task = await loadTask(db, run.taskId);
    if (!task) return;
    const comments = await userCommentsSince(db, run.taskId, new Date(run.startedAt));
    const goOn = continuesAfterRun({
      runStatus: run.status as RunStatus,
      taskStatus: task.status,
      userCommentsSinceStart: comments,
    });
    if (!goOn) return;
    await enqueueRun(db, run.taskId, followUpInput({ ...run, limitMode: run.limitMode as LimitMode }), "comment", run);
  }

  private async dispatch(db: Db, run: RunRow) {
    const task = await loadTask(db, run.taskId);
    if (!task || !gatewayConnection()) {
      await finalizeRun(db, run, { status: "failed", error: task ? "agent disabled" : "task not found" });
      return;
    }
    const settings = await getAgentSettings(db);

    let started: TurnStarted;
    let current = run;
    try {
      if (run.continuesRunId) {
        try {
          ({ started, run: current } = await this.sendFollowUp(db, run, task));
        } catch (error) {
          // The conversation is gone (never started, deleted or reset): start a new
          // one that sees the whole task and its comments instead.
          if (!(error instanceof SessionMissingError) && !/session not found/i.test(errorText(error))) throw error;
          current = { ...run, sessionKey: newSessionKey(run.taskId), continuesRunId: null, usageBaseline: 0 };
          await updateRun(db, run.id, { sessionKey: current.sessionKey, continuesRunId: null, usageBaseline: 0 });
          started = await this.createSession(db, current, task, settings);
        }
      } else {
        started = await this.createSession(db, run, task, settings);
      }
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        // Probably still starting next to the app; try again on a later tick.
        await requeueRun(db, current);
        await sleep(TICK_MS);
        return;
      }
      await finalizeRun(db, current, failure(errorText(error)));
      return;
    }
    if (!started.runId || started.runError) {
      await finalizeRun(db, current, failure(started.runError?.message ?? "the run did not start"));
      return;
    }
    await updateRun(db, current.id, { openclawRunId: started.runId });
    if (task.status !== "in_progress" && task.status !== "done") await moveTaskTo(db, task.id, "in_progress");
    await this.watch(db, { ...current, openclawRunId: started.runId, startedAt: current.startedAt ?? new Date() });
  }

  /** The first turn of a task's conversation: a new OpenClaw session with the whole task. */
  private async createSession(db: Db, run: RunRow, task: Task, settings: AgentSettings): Promise<TurnStarted> {
    const [comments, tagRows] = await Promise.all([
      listComments(db, task.id),
      task.tagIds.length
        ? db.select({ name: tags.name }).from(tags).where(inArray(tags.id, task.tagIds))
        : Promise.resolve([]),
    ]);
    const message = buildRunPrompt({
      task,
      tagNames: tagRows.map((tag) => tag.name),
      comments,
      instructions: settings.instructions,
      tokenLimit: run.tokenLimit,
      limitMode: run.limitMode as LimitMode,
      timeoutSeconds: run.timeoutSeconds,
    });
    return gatewayRequest<TurnStarted>(
      "sessions.create",
      {
        // No idempotency key: the Gateway only takes one from device-paired clients.
        // The unique session key (renewed on requeue) keeps a run from starting twice.
        key: run.sessionKey,
        // Labels must be unique in OpenClaw; the session key's tail differs per attempt.
        label: `Task #${task.id} · ${run.sessionKey.slice(-8)} · ${task.title}`.slice(0, 120),
        message,
        timeoutMs: run.timeoutSeconds * 1000,
        ...(run.agentId ? { agentId: run.agentId } : {}),
        ...(run.model ? { model: run.model } : {}),
        ...(run.thinking ? { thinkingLevel: run.thinking } : {}),
      },
      { timeoutMs: 60_000, connectTimeoutMs: 15_000 },
    );
  }

  /** A follow-up turn in the task's existing session, with just what's new. */
  private async sendFollowUp(db: Db, run: RunRow, task: Task): Promise<{ started: TurnStarted; run: RunRow }> {
    const previous = run.continuesRunId ? await runById(db, run.continuesRunId) : null;
    const since = new Date(previous?.startedAt ?? previous?.createdAt ?? 0);
    const newComments = (await listComments(db, task.id)).filter(
      (comment) => comment.author === "user" && new Date(comment.createdAt) > since,
    );
    // Token usage is per session; this run spends what's added from here on.
    // Checked first: patching a missing session would quietly create an empty one,
    // and the agent would get this short follow-up without the task's history.
    const described = await gatewayRequest<{ session?: { sessionId?: string } | null }>("sessions.describe", {
      key: run.sessionKey,
      ...(run.agentId ? { agentId: run.agentId } : {}),
    });
    if (!described.session?.sessionId) throw new SessionMissingError(run.sessionKey);
    const usageBaseline = (await sessionTokens(run.sessionKey)) ?? 0;
    await updateRun(db, run.id, { usageBaseline });
    if (run.model || run.thinking) {
      await gatewayRequest("sessions.patch", {
        key: run.sessionKey,
        ...(run.agentId ? { agentId: run.agentId } : {}),
        ...(run.model ? { model: run.model } : {}),
        ...(run.thinking ? { thinkingLevel: run.thinking } : {}),
      });
    }
    const started = await gatewayRequest<TurnStarted>(
      "sessions.send",
      {
        key: run.sessionKey,
        message: buildFollowUpPrompt({
          task,
          newComments,
          tokenLimit: run.tokenLimit,
          limitMode: run.limitMode as LimitMode,
          timeoutSeconds: run.timeoutSeconds,
        }),
        timeoutMs: run.timeoutSeconds * 1000,
        ...(run.agentId ? { agentId: run.agentId } : {}),
      },
      { timeoutMs: 60_000, connectTimeoutMs: 15_000 },
    );
    return { started, run: { ...run, usageBaseline } };
  }

  /** Follows a running run until it ends, enforcing the hard budget and the time limit. */
  private async watch(db: Db, run: RunRow) {
    const settings = await getAgentSettings(db);
    const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    const deadline = startedAt + run.timeoutSeconds * 1000 + DEADLINE_GRACE_MS;
    let tokensUsed = run.tokensUsed;
    const spent = async () => {
      const total = await sessionTokens(run.sessionKey);
      return total == null ? tokensUsed : runTokens(total, run.usageBaseline);
    };

    while (true) {
      // The stop button (or removing the agent tag) ended it.
      if ((await runStatus(db, run.id)) !== "running") return;

      const used = await spent();
      if (used !== tokensUsed) {
        tokensUsed = used;
        await updateRun(db, run.id, { tokensUsed });
      }
      if (run.limitMode === "hard" && tokensUsed >= run.tokenLimit) {
        await abortSession(run);
        await finalizeRun(db, run, {
          status: "budget_exceeded",
          tokensUsed,
          moveTo: settings.statusOnBlocked,
          comment: {
            author: "system",
            body: systemCommentBody("agentRun.systemBudget", { used: tokensUsed, limit: run.tokenLimit }),
          },
        });
        return;
      }
      if (Date.now() > deadline) {
        await abortSession(run);
        await finalizeRun(db, run, {
          status: "timed_out",
          tokensUsed,
          moveTo: settings.statusOnBlocked,
          comment: {
            author: "system",
            body: systemCommentBody("agentRun.systemTimedOut", { minutes: Math.round(run.timeoutSeconds / 60) }),
          },
        });
        return;
      }

      let result: WaitResult;
      try {
        result = await gatewayRequest<WaitResult>(
          "agent.wait",
          { runId: run.openclawRunId, timeoutMs: WAIT_SLICE_MS },
          { timeoutMs: WAIT_SLICE_MS + 15_000, connectTimeoutMs: 15_000 },
        );
      } catch (error) {
        if (error instanceof GatewayUnavailableError) {
          await sleep(TICK_MS);
          continue;
        }
        await finalizeRun(db, run, { ...failure(errorText(error)), tokensUsed, moveTo: settings.statusOnBlocked });
        return;
      }

      const status = result.status ?? "";
      // "timeout" means only that this wait slice ended; the run goes on.
      if (status === "timeout" || status === "pending" || status === "running" || status === "") continue;

      tokensUsed = await spent();
      if (status === "cancelled" || status === "aborted") {
        await finalizeRun(db, run, {
          status: "aborted",
          tokensUsed,
          comment: { author: "system", body: systemCommentBody("agentRun.systemAborted") },
        });
        return;
      }
      if (status === "error" || status === "failed") {
        await finalizeRun(db, run, {
          ...failure(errorText(result.error ?? result.message)),
          tokensUsed,
          moveTo: settings.statusOnBlocked,
        });
        return;
      }
      // The turn is over: the agent's final message is its report. Without one the
      // app says so, so every run leaves a comment behind.
      if ((await runStatus(db, run.id)) !== "running") return;
      const report = parseRunReport(await finalReply(run, result));
      await finalizeRun(
        db,
        run,
        report
          ? {
              status: report.outcome,
              tokensUsed,
              moveTo: report.outcome === "done" ? settings.statusOnDone : settings.statusOnBlocked,
              comment: { author: "agent", body: report.body },
            }
          : {
              status: "blocked",
              error: "ended without a report",
              tokensUsed,
              moveTo: settings.statusOnBlocked,
              comment: { author: "system", body: systemCommentBody("agentRun.systemNoReportEmpty") },
            },
      );
      return;
    }
  }
}

const globalForWorker = globalThis as unknown as { taskPanelAgentWorker?: AgentWorker };

function worker(): AgentWorker {
  globalForWorker.taskPanelAgentWorker ??= new AgentWorker();
  return globalForWorker.taskPanelAgentWorker;
}

export function startAgentWorker(): void {
  worker().start();
}

export function pokeAgentWorker(): void {
  if (gatewayConnection()) worker().poke();
}
