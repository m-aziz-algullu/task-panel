// Comments Task Panel writes about a run (budget spent, time out, failure…). Stored
// as a message key plus values, so each viewer reads them in their own language.

import type { MessageKey, Vars } from "@/i18n/translate";

export type SystemMessage = { key: MessageKey; vars?: Vars };

export function systemCommentBody(key: MessageKey, vars?: Vars): string {
  return JSON.stringify({ key, vars });
}

/** The message in a system comment, or null for plain text. */
export function parseSystemComment(body: string): SystemMessage | null {
  if (!body.startsWith("{")) return null;
  try {
    const value = JSON.parse(body) as { key?: unknown; vars?: unknown };
    if (typeof value.key !== "string" || !value.key.startsWith("agentRun.")) return null;
    return { key: value.key as MessageKey, vars: (value.vars ?? undefined) as Vars | undefined };
  } catch {
    return null;
  }
}
