import "server-only";

import { randomUUID } from "node:crypto";
import { gatewayRequest } from "../openclaw/client";
import { buildChatMessage, CHAT_SESSION_PREFIX } from "./chat-shape";
import { errorText, turnReply } from "./reply";

/** One chat turn's time limit; the browser stops waiting at the same point. */
const TURN_TIMEOUT_MS = 30 * 60_000;
/** How long one wait request blocks before the browser asks again. */
const WAIT_SLICE_MS = 25_000;

type TurnStarted = { runId?: string; runError?: { message?: string } };

export type ChatFile = { name: string; type: string; bytes: Buffer };

export type ChatTurnState =
  | { status: "running" }
  | { status: "done"; reply: string | null }
  | { status: "failed"; error: string }
  | { status: "aborted" };

/**
 * Sends the user's message to the agent: a new chat session for the first one,
 * the same session after that. No agent id, so it is the default agent, the
 * same one (with the same memory) that task runs use.
 */
export async function startChatTurn({
  sessionKey,
  message,
  files,
}: {
  sessionKey: string | null;
  message: string;
  files: ChatFile[];
}): Promise<{ sessionKey: string; runId: string }> {
  const attachments = files.map((file) => ({
    type: file.type.startsWith("image/") ? "image" : "file",
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
    origin: "file" as const,
    sizeBytes: file.bytes.length,
    content: file.bytes.toString("base64"),
  }));
  const text = buildChatMessage(message, { first: sessionKey == null, fileNames: files.map((file) => file.name) });
  const options = { timeoutMs: 120_000, connectTimeoutMs: 15_000 };

  let key = sessionKey;
  let started: TurnStarted;
  if (key == null) {
    key = `${CHAT_SESSION_PREFIX}${randomUUID()}`;
    started = await gatewayRequest<TurnStarted>(
      "sessions.create",
      {
        key,
        // Labels must be unique in OpenClaw.
        label: `Task Panel chat · ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${key.slice(-8)}`,
        message: text,
        timeoutMs: TURN_TIMEOUT_MS,
        ...(attachments.length ? { attachments } : {}),
      },
      options,
    );
  } else {
    started = await gatewayRequest<TurnStarted>(
      "sessions.send",
      { key, message: text, timeoutMs: TURN_TIMEOUT_MS, ...(attachments.length ? { attachments } : {}) },
      options,
    );
  }
  if (!started.runId) throw new Error(started.runError?.message ?? "The agent didn't start");
  return { sessionKey: key, runId: started.runId };
}

/** Waits a little for the turn; the browser asks again while it is still running. */
export async function waitChatTurn(sessionKey: string, runId: string): Promise<ChatTurnState> {
  const result = await gatewayRequest<{ status?: string; error?: unknown; message?: string }>(
    "agent.wait",
    { runId, timeoutMs: WAIT_SLICE_MS },
    { timeoutMs: WAIT_SLICE_MS + 15_000, connectTimeoutMs: 15_000 },
  );
  const status = result.status ?? "";
  if (status === "timeout" || status === "pending" || status === "running" || status === "") return { status: "running" };
  if (status === "cancelled" || status === "aborted") return { status: "aborted" };
  if (status === "error" || status === "failed") return { status: "failed", error: errorText(result.error ?? result.message) };
  return { status: "done", reply: await turnReply({ runId, sessionKey, result }) };
}

export async function stopChatTurn(sessionKey: string, runId: string): Promise<void> {
  await gatewayRequest("sessions.abort", { key: sessionKey, runId, clearQueued: true });
}
