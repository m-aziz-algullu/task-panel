import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { GatewayUnavailableError, gatewayRequest } from "../openclaw/client";
import { AGENT_SESSION_KEY_PREFIX } from "../types";
import { isClaudeAuthError, type ClaudeHealth } from "./claude-auth";
import { errorText, turnReply } from "./reply";
import { getAgentSettings } from "./settings";

const { appSettings } = schema;
const KEY = "agent.claudeHealth";

/** The check's own turn limit; a working sign-in answers in seconds. */
const CHECK_TIMEOUT_MS = 90_000;
const WAIT_SLICE_MS = 10_000;
const CHECK_PROMPT = "This is an automated connection check. Reply with the single word OK and nothing else.";

export async function readClaudeHealth(db: Db): Promise<ClaudeHealth | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as Partial<ClaudeHealth>;
    if (typeof value.ok !== "boolean" || typeof value.at !== "string") return null;
    return {
      ok: value.ok,
      at: value.at,
      source: value.source === "check" ? "check" : "run",
      error: typeof value.error === "string" ? value.error : null,
    };
  } catch {
    return null;
  }
}

/** Remembers what a real turn just saw; the newest observation wins. */
export async function recordClaudeHealth(
  db: Db,
  observation: { ok: boolean; source: ClaudeHealth["source"]; error?: string | null },
): Promise<void> {
  const health: ClaudeHealth = {
    ok: observation.ok,
    at: new Date().toISOString(),
    source: observation.source,
    error: observation.ok ? null : (observation.error ?? null),
  };
  const value = JSON.stringify(health);
  await db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/**
 * What a run's failure says about the sign-in: a Claude auth error marks it
 * expired. Best effort, so bookkeeping never stands in the way of ending a run.
 */
export async function noteRunFailure(db: Db, reason: string): Promise<void> {
  if (!isClaudeAuthError(reason)) return;
  await recordClaudeHealth(db, { ok: false, source: "run", error: reason }).catch((error) =>
    console.warn("[agent] Could not record the Claude sign-in state:", errorText(error)),
  );
}

/** Claude answered a run, so the sign-in works. Best effort, like noteRunFailure. */
export async function noteRunAnswered(db: Db): Promise<void> {
  await recordClaudeHealth(db, { ok: true, source: "run" }).catch((error) =>
    console.warn("[agent] Could not record the Claude sign-in state:", errorText(error)),
  );
}

export type ClaudeCheckResult =
  | { outcome: "ok" }
  /** Claude Code refused: the sign-in is gone and has to be done again. */
  | { outcome: "auth"; error: string }
  /** Anything else (Gateway down, timeout, rate limit…): says nothing about the sign-in. */
  | { outcome: "error"; error: string };

type TurnStarted = { runId?: string; runError?: { message?: string } };
type WaitResult = { status?: string; error?: unknown; message?: string };

const globalForCheck = globalThis as unknown as { taskPanelClaudeCheck?: Promise<ClaudeCheckResult> };

/**
 * Proves the sign-in the only way that is honest for a Claude Code subscription:
 * one tiny real turn through the same agent and model as task runs. Claude Code
 * refreshes its OAuth session on the way, so a session that can still be refreshed
 * passes (and stays fresh), and one that can't fails with the same error a run
 * would. The result is recorded; concurrent callers share one check.
 */
export function checkClaude(db: Db): Promise<ClaudeCheckResult> {
  globalForCheck.taskPanelClaudeCheck ??= runCheck(db).finally(() => {
    globalForCheck.taskPanelClaudeCheck = undefined;
  });
  return globalForCheck.taskPanelClaudeCheck;
}

async function runCheck(db: Db): Promise<ClaudeCheckResult> {
  const result = await probe(db);
  if (result.outcome !== "error") {
    await recordClaudeHealth(db, {
      ok: result.outcome === "ok",
      source: "check",
      error: result.outcome === "auth" ? result.error : null,
    });
  }
  return result;
}

function classify(error: string): ClaudeCheckResult {
  return isClaudeAuthError(error) ? { outcome: "auth", error } : { outcome: "error", error };
}

async function probe(db: Db): Promise<ClaudeCheckResult> {
  const settings = await getAgentSettings(db);
  const key = `${AGENT_SESSION_KEY_PREFIX}claude-check:${randomUUID()}`;
  const agent = settings.agentId ? { agentId: settings.agentId } : {};
  let runId: string | undefined;
  let finished = false;
  try {
    const started = await gatewayRequest<TurnStarted>(
      "sessions.create",
      {
        key,
        label: `Claude sign-in check · ${key.slice(-8)}`,
        message: CHECK_PROMPT,
        timeoutMs: CHECK_TIMEOUT_MS,
        ...agent,
        ...(settings.model ? { model: settings.model } : {}),
        thinkingLevel: "off",
      },
      { timeoutMs: 60_000, connectTimeoutMs: 15_000 },
    );
    if (started.runError || !started.runId) {
      finished = true;
      return classify(started.runError?.message ?? "the check did not start");
    }
    runId = started.runId;
    const deadline = Date.now() + CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await gatewayRequest<WaitResult>(
        "agent.wait",
        { runId, timeoutMs: WAIT_SLICE_MS },
        { timeoutMs: WAIT_SLICE_MS + 15_000, connectTimeoutMs: 15_000 },
      );
      const status = result.status ?? "";
      if (status === "timeout" || status === "pending" || status === "running" || status === "") continue;
      finished = true;
      if (status === "ok") {
        // OpenClaw can also end the turn with its "couldn't be completed" notice as the reply.
        const reply = await turnReply({ runId, sessionKey: key, agentId: settings.agentId, result });
        if (isClaudeAuthError(reply)) return { outcome: "auth", error: reply! };
        return reply ? { outcome: "ok" } : { outcome: "error", error: "Claude did not answer the check" };
      }
      return classify(errorText(result.error ?? result.message ?? status));
    }
    return { outcome: "error", error: "the check timed out" };
  } catch (error) {
    if (error instanceof GatewayUnavailableError) return { outcome: "error", error: "OpenClaw is not reachable" };
    return classify(errorText(error));
  } finally {
    // The check leaves nothing behind in OpenClaw: no running turn, no session.
    if (runId && !finished) {
      await gatewayRequest("sessions.abort", { key, runId, ...agent, clearQueued: true }).catch(() => {});
    }
    await gatewayRequest("sessions.delete", { key, ...agent, deleteTranscript: true }).catch(() => {});
  }
}
