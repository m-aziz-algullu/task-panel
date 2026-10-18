// The panel chat with the agent: its session keys, file limits and the framing of
// its first message. Pure, so it can be tested and shared with the browser.

import { AGENT_SESSION_KEY_PREFIX } from "../types";

/** Chat sessions sit apart from task sessions, so the chat can't touch a task's conversation. */
export const CHAT_SESSION_PREFIX = `${AGENT_SESSION_KEY_PREFIX}chat:`;

export const MAX_CHAT_MESSAGE_LENGTH = 20_000;
export const MAX_CHAT_FILES = 5;
// Below OpenClaw's own 20 MB: files travel base64-encoded in one Gateway frame.
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_TOTAL_BYTES = 15 * 1024 * 1024;

export function isChatSessionKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= 200 && /^[\w:-]+$/.test(key) && key.startsWith(CHAT_SESSION_PREFIX);
}

export type ChatFileError = "chatTooManyFiles" | "chatFileTooLarge" | "chatFilesTooLarge";

/** Why these files can't be sent, or null when they can. */
export function chatFilesError(files: { size: number }[]): ChatFileError | null {
  if (files.length > MAX_CHAT_FILES) return "chatTooManyFiles";
  if (files.some((file) => file.size > MAX_CHAT_FILE_BYTES)) return "chatFileTooLarge";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_CHAT_TOTAL_BYTES) return "chatFilesTooLarge";
  return null;
}

/**
 * The message the agent gets. The first one of a chat says where it comes from
 * and that what the user shares about themselves belongs in the agent's memory,
 * which its task runs read too.
 */
export function buildChatMessage(message: string, { first, fileNames }: { first: boolean; fileNames: string[] }): string {
  const text = message.trim() || (fileNames.length ? "(The user sent files without a message.)" : "");
  if (!first) return text;
  return [
    "Task Panel: the user is talking to you from the chat window of Task Panel, their personal kanban board. It's the same you that works on their tasks there.",
    "They may tell you about themselves, their preferences or how you should work, or ask you to change your own setup. Save what will matter for later tasks in your memory (USER.md for the user's profile and preferences, MEMORY.md for other lasting facts), so your task runs know it too. Files they send are in your workspace.",
    "Answer in the user's language.",
    "",
    "---",
    "",
    text,
  ].join("\n");
}
