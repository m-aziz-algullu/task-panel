import type { NextRequest } from "next/server";
import { startChatTurn, type ChatFile } from "@/lib/agent/chat";
import { chatFilesError, isChatSessionKey, MAX_CHAT_MESSAGE_LENGTH } from "@/lib/agent/chat-shape";
import { GatewayUnavailableError } from "@/lib/openclaw/client";
import { agentEnabled } from "@/lib/openclaw/connection";
import { getCurrentUser } from "@/lib/session";
import { chatError, sameOrigin } from "./shared";

// One message to the agent from the panel chat, with optional files. A route
// handler rather than a Server Action: files go past the Server Action body limit.
export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return chatError("errors.unauthorized", 401);
  if (!sameOrigin(request)) return chatError("errors.generic", 403);
  if (!agentEnabled()) return chatError("errors.agentUnavailable", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return chatError("errors.invalid", 400);
  }
  const message = form.get("message");
  const sessionKey = form.get("sessionKey");
  const uploads = form.getAll("files").filter((value): value is File => value instanceof File);
  if (typeof message !== "string" || message.length > MAX_CHAT_MESSAGE_LENGTH) return chatError("errors.invalid", 400);
  if (!message.trim() && uploads.length === 0) return chatError("errors.chatMessageRequired", 400);
  if (sessionKey != null && !isChatSessionKey(sessionKey)) return chatError("errors.invalid", 400);
  const fileError = chatFilesError(uploads);
  if (fileError) return chatError(`errors.${fileError}`, 400);

  const files: ChatFile[] = await Promise.all(
    uploads.map(async (file) => ({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })),
  );
  try {
    const turn = await startChatTurn({ sessionKey: sessionKey ?? null, message, files });
    return Response.json(turn, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GatewayUnavailableError) return chatError("errors.agentUnavailable", 503);
    console.warn("[agent] Chat message failed:", error instanceof Error ? error.message : error);
    return chatError("errors.chatSendFailed", 502);
  }
}
