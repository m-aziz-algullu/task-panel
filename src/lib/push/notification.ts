// The text of the notifications Task Panel sends, per device language. Pure.

import { INTL_LOCALE, hasLocale, DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import en from "@/i18n/dictionaries/en";
import tr, { type Dictionary } from "@/i18n/dictionaries/tr";
import { translate, type MessageKey, type Vars } from "@/i18n/translate";
import { parseSystemComment } from "../agent/system-comments";
import type { CommentAuthor, RunStatus } from "../types";
import { excerpt, type PushPayload } from "./shape";

const DICTIONARIES: Record<Locale, Dictionary> = { en, tr };

export function pushLocale(value: string | null | undefined): Locale {
  return hasLocale(value ?? undefined) ? (value as Locale) : DEFAULT_LOCALE;
}

function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  return translate(DICTIONARIES[locale], INTL_LOCALE[locale], key, vars);
}

export type PushMessage = { payload: PushPayload; topic: string | null };

/** Run outcomes worth a notification: the agent is done, or it stopped and needs the user. */
export function notifiesRunEnd(status: RunStatus): boolean {
  // Aborted runs were stopped by the user themselves; queued/running haven't ended.
  return status !== "aborted" && status !== "queued" && status !== "running";
}

export type RunEnd = {
  status: RunStatus;
  task: { id: number; title: string };
  /** The closing comment the run left: the agent's report or the app's note on why it stopped. */
  comment?: { author: CommentAuthor; body: string } | null;
};

/** The notification for an agent run that ended; null if this outcome doesn't get one. */
export function runEndMessage(end: RunEnd, rawLocale: string): PushMessage | null {
  if (!notifiesRunEnd(end.status)) return null;
  const locale = pushLocale(rawLocale);
  const done = end.status === "done";
  const title = t(locale, done ? "push.runDoneTitle" : "push.runBlockedTitle", { title: end.task.title });

  let detail = "";
  if (end.comment) {
    const system = end.comment.author === "system" ? parseSystemComment(end.comment.body) : null;
    detail = system ? t(locale, system.key, system.vars) : excerpt(end.comment.body);
  }
  const body = detail || t(locale, done ? "push.runDoneBody" : "push.runBlockedBody", { id: end.task.id });

  return {
    payload: {
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      body,
      url: `/${locale}?task=${end.task.id}`,
      tag: `task-${end.task.id}`,
    },
    // Undelivered news about the same task is replaced, not piled up, while the device is offline.
    topic: `task-${end.task.id}`,
  };
}

/** The notification "Send a test" sends. */
export function testMessage(rawLocale: string): PushMessage {
  const locale = pushLocale(rawLocale);
  return {
    payload: { title: t(locale, "push.testTitle"), body: t(locale, "push.testBody"), url: `/${locale}/settings`, tag: "test" },
    topic: null,
  };
}
