import "server-only";

import { recoverTerminalReply } from "@openclaw/gateway-client";
import { gatewayRequest } from "../openclaw/client";

export function errorText(value: unknown): string {
  if (!value) return "unknown error";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
  return JSON.stringify(value);
}

/** The agent's final message of a finished turn; null when there is none. */
export async function turnReply({
  runId,
  sessionKey,
  agentId,
  result,
}: {
  runId: string | null;
  sessionKey: string;
  agentId?: string | null;
  result: unknown;
}): Promise<string | null> {
  if (!runId) return null;
  try {
    const recovered = await recoverTerminalReply({
      runId,
      scope: { sessionKey, ...(agentId ? { agentId } : {}) },
      result,
      request: (method, params) => gatewayRequest(method, params),
      signal: AbortSignal.timeout(30_000),
    });
    return recovered.outputText?.trim() || null;
  } catch {
    return null;
  }
}
