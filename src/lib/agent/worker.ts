import "server-only";

import { recoverTerminalReply } from "@openclaw/gateway-client";
import { inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { listComments, loadTask } from "../data";
import { GatewayUnavailableError, gatewayRequest } from "../openclaw/client";
import { gatewayConnection } from "../openclaw/connection";
import { moveTaskTo } from "../task-status";
import { buildRunPrompt } from "./prompt";
import {
  claimNextRun,
  finalizeRun,
  requeueRun,
  runStatus,
  runningRuns,
  updateRun,
  type RunRow,
} from "./runs";
import { getAgentSettings } from "./settings";
import { systemCommentBody } from "./system-comments";

const { tags } = schema;

const TICK_MS = 5_000;
/** How long one agent.wait call blocks before the watcher checks usage and deadlines again. */
const WAIT_SLICE_MS = 10_000;
/** OpenClaw's own turn timeout gets a little head start before Task Panel steps in. */
const DEADLINE_GRACE_MS = 60_000;
const MAX_OUTPUT_CHARS = 4_000;

type WaitResult = { status?: string; error?: unknown; message?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorText(value: unknown): string {
  if (!value) return "unknown error";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
  return JSON.stringify(value);
}

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

/** The agent's last reply, for a run that ended without calling finish. */
async function finalReply(run: RunRow, result: unknown): Promise<string | null> {
  if (!run.openclawRunId) return null;
  try {
    const recovered = await recoverTerminalReply({
      runId: run.openclawRunId,
      scope: { sessionKey: run.sessionKey, ...(run.agentId ? { agentId: run.agentId } : {}) },
      result,
      request: (method, params) => gatewayRequest(method, params),
      signal: AbortSignal.timeout(30_000),
    });
    const text = recovered.outputText?.trim();
    if (!text) return null;
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text;
  } catch {
    return null;
  }
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
        if (row.openclawRunId) this.track(row.id, () => this.watch(db, row));
        else await requeueRun(db, row);
      }
      let free = settings.concurrency - running.length;
      while (free-- > 0) {
        const claimed = await claimNextRun(db);
        if (!claimed) break;
        this.track(claimed.row.id, () => this.dispatch(db, claimed.row, claimed.token));
      }
    } catch (error) {
      console.error("[agent] Worker tick failed:", error);
    } finally {
      this.ticking = false;
    }
  }

  private track(runId: number, work: () => Promise<void>) {
    this.watching.add(runId);
    work()
      .catch((error) => console.error(`[agent] Run ${runId} failed:`, error))
      .finally(() => {
        this.watching.delete(runId);
        this.poke();
      });
  }

  private async dispatch(db: Db, run: RunRow, token: string) {
    const connection = gatewayConnection();
    const task = await loadTask(db, run.taskId);
    if (!task || !connection) {
      await finalizeRun(db, run, { status: "failed", error: task ? "agent disabled" : "task not found" });
      return;
    }
    const settings = await getAgentSettings(db);
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
      apiBase: connection.appUrl,
      runToken: token,
      tokenLimit: run.tokenLimit,
      limitMode: run.limitMode as "soft" | "hard",
      timeoutSeconds: run.timeoutSeconds,
    });

    let created: { runId?: string; runStarted?: boolean; runError?: { message?: string } };
    try {
      created = await gatewayRequest(
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
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        // Probably still starting next to the app; try again on a later tick.
        await requeueRun(db, run);
        await sleep(TICK_MS);
        return;
      }
      await finalizeRun(db, run, {
        status: "failed",
        error: errorText(error),
        comment: { author: "system", body: systemCommentBody("agentRun.systemFailed", { error: errorText(error) }) },
      });
      return;
    }
    if (!created.runId || created.runError) {
      const reason = created.runError?.message ?? "the run did not start";
      await finalizeRun(db, run, {
        status: "failed",
        error: reason,
        comment: { author: "system", body: systemCommentBody("agentRun.systemFailed", { error: reason }) },
      });
      return;
    }
    await updateRun(db, run.id, { openclawRunId: created.runId });
    if (task.status !== "in_progress" && task.status !== "done") await moveTaskTo(db, task.id, "in_progress");
    await this.watch(db, { ...run, openclawRunId: created.runId, startedAt: run.startedAt ?? new Date() });
  }

  /** Follows a running run until it ends, enforcing the hard budget and the time limit. */
  private async watch(db: Db, run: RunRow) {
    const settings = await getAgentSettings(db);
    const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    const deadline = startedAt + run.timeoutSeconds * 1000 + DEADLINE_GRACE_MS;
    let tokensUsed = run.tokensUsed;

    while (true) {
      // The agent's finish call or the stop button ended it.
      if ((await runStatus(db, run.id)) !== "running") return;

      const used = await sessionTokens(run.sessionKey);
      if (used != null && used !== tokensUsed) {
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
        const reason = errorText(error);
        await finalizeRun(db, run, {
          status: "failed",
          error: reason,
          tokensUsed,
          moveTo: settings.statusOnBlocked,
          comment: { author: "system", body: systemCommentBody("agentRun.systemFailed", { error: reason }) },
        });
        return;
      }

      const status = result.status ?? "";
      // "timeout" means only that this wait slice ended; the run goes on.
      if (status === "timeout" || status === "pending" || status === "running" || status === "") continue;

      tokensUsed = (await sessionTokens(run.sessionKey)) ?? tokensUsed;
      if (status === "cancelled" || status === "aborted") {
        await finalizeRun(db, run, {
          status: "aborted",
          tokensUsed,
          comment: { author: "system", body: systemCommentBody("agentRun.systemAborted") },
        });
        return;
      }
      if (status === "error" || status === "failed") {
        const reason = errorText(result.error ?? result.message);
        await finalizeRun(db, run, {
          status: "failed",
          error: reason,
          tokensUsed,
          moveTo: settings.statusOnBlocked,
          comment: { author: "system", body: systemCommentBody("agentRun.systemFailed", { error: reason }) },
        });
        return;
      }
      // The turn is over. If the agent never called finish, its last reply goes
      // into the task instead, so every run leaves a comment behind.
      if ((await runStatus(db, run.id)) !== "running") return;
      const output = await finalReply(run, result);
      await finalizeRun(db, run, {
        status: "blocked",
        error: "ended without calling finish",
        tokensUsed,
        moveTo: settings.statusOnBlocked,
        comment: {
          author: "system",
          body: output
            ? systemCommentBody("agentRun.systemNoReport", { output })
            : systemCommentBody("agentRun.systemNoReportEmpty"),
        },
      });
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
