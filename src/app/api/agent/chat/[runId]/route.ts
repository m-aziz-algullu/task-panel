import type { NextRequest } from "next/server";
import { stopChatTurn, waitChatTurn } from "@/lib/agent/chat";
import { isChatSessionKey } from "@/lib/agent/chat-shape";
import { GatewayUnavailableError } from "@/lib/openclaw/client";
import { agentEnabled } from "@/lib/openclaw/connection";
import { getCurrentUser } from "@/lib/session";
import { chatError, sameOrigin } from "../shared";

async function turn(request: NextRequest, ctx: RouteContext<"/api/agent/chat/[runId]">) {
  if (!(await getCurrentUser())) return { error: chatError("errors.unauthorized", 401) };
  if (!agentEnabled()) return { error: chatError("errors.agentUnavailable", 503) };
  const { runId } = await ctx.params;
  const sessionKey = request.nextUrl.searchParams.get("session");
  if (!isChatSessionKey(sessionKey) || !/^[\w-]{1,200}$/.test(runId)) return { error: chatError("errors.invalid", 400) };
  return { sessionKey, runId };
}

// The turn's state; waits up to ~25 s for it to end, and the chat asks again while it runs.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/agent/chat/[runId]">) {
  const target = await turn(request, ctx);
  if ("error" in target) return target.error;
  try {
    return Response.json(await waitChatTurn(target.sessionKey, target.runId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GatewayUnavailableError) return chatError("errors.agentUnavailable", 503);
    return chatError("errors.generic", 502);
  }
}

// The stop button.
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/agent/chat/[runId]">) {
  if (!sameOrigin(request)) return chatError("errors.generic", 403);
  const target = await turn(request, ctx);
  if ("error" in target) return target.error;
  try {
    await stopChatTurn(target.sessionKey, target.runId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GatewayUnavailableError) return chatError("errors.agentUnavailable", 503);
    return chatError("errors.generic", 502);
  }
}
