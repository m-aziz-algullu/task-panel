"use client";

import { Bot, Info, Trash2, User } from "lucide-react";
import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { addComment, deleteComment } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey, Translate, Vars } from "@/i18n/translate";
import { parseSystemComment } from "@/lib/agent/system-comments";
import { formatDateTime } from "@/lib/dates";
import { MAX_COMMENT_LENGTH, type CommentAuthor, type TaskComment } from "@/lib/types";

const AUTHOR_META: Record<CommentAuthor, { label: MessageKey; icon: typeof User; className: string }> = {
  user: { label: "comments.you", icon: User, className: "bg-surface-2 text-fg" },
  agent: { label: "comments.agent", icon: Bot, className: "bg-accent/15 text-accent" },
  system: { label: "comments.system", icon: Info, className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

/** Plain text, or for Task Panel's own run reports the message in the viewer's language. */
function commentText(comment: TaskComment, t: Translate, intlLocale: string): string {
  // Only the app writes system comments; anyone else's text is shown as written.
  const system = comment.author === "system" ? parseSystemComment(comment.body) : null;
  if (!system) return comment.body;
  const numbers = new Intl.NumberFormat(intlLocale);
  const vars: Vars = Object.fromEntries(
    Object.entries(system.vars ?? {}).map(([name, value]) => [
      name,
      typeof value === "number" ? numbers.format(value) : value,
    ]),
  );
  return t(system.key, vars);
}

type TaskCommentsProps = {
  taskId: number;
  timeZone: string;
  /** Loaded by the dialog together with the agent run (null while loading). */
  comments: TaskComment[] | null;
  setComments: Dispatch<SetStateAction<TaskComment[] | null>>;
  loadFailed: boolean;
  /** The agent has worked on this task, so a new comment continues its conversation. */
  toAgent: boolean;
  /** After a comment is added: the agent may have picked it up. */
  onAdded: () => void;
};

export function TaskComments({ taskId, timeZone, comments, setComments, loadFailed, toAgent, onAdded }: TaskCommentsProps) {
  const { t, intlLocale } = useI18n();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!draft.trim()) return;
    startTransition(async () => {
      const result = await addComment(taskId, draft);
      if (!result.ok) return setError(result.error);
      setComments((current) => [...(current ?? []), result.data]);
      setDraft("");
      setError(null);
      onAdded();
    });
  };

  const remove = (commentId: number) => {
    if (!confirm(t("comments.deleteConfirm"))) return;
    startTransition(async () => {
      const result = await deleteComment(commentId);
      if (!result.ok) return setError(result.error);
      setComments((current) => current?.filter((comment) => comment.id !== commentId) ?? null);
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold text-muted">{t("comments.title")}</span>

      {loadFailed && !comments && <p className="text-xs text-red-600 dark:text-red-400">{t("comments.loadError")}</p>}
      {comments?.length === 0 && <p className="text-xs text-muted">{t("comments.empty")}</p>}
      {comments && comments.length > 0 && (
        <ol className="flex flex-col gap-2">
          {comments.map((comment) => {
            const meta = AUTHOR_META[comment.author];
            const Icon = meta.icon;
            return (
              <li key={comment.id} className="group flex flex-col gap-1 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${meta.className}`}
                  >
                    <Icon className="size-3" />
                    {t(meta.label)}
                  </span>
                  <time className="text-muted" dateTime={comment.createdAt}>
                    {formatDateTime(comment.createdAt, timeZone, intlLocale)}
                  </time>
                  <button
                    type="button"
                    className="icon-btn ml-auto size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={t("comments.delete")}
                    title={t("comments.delete")}
                    disabled={pending}
                    onClick={() => remove(comment.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{commentText(comment, t, intlLocale)}</p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          className="input resize-y text-sm"
          rows={2}
          placeholder={t("comments.placeholder")}
          value={draft}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl+Enter here sends the comment instead of saving the task form around it.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.stopPropagation();
              submit();
            }
          }}
        />
        {toAgent && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-agent">
            <Bot className="size-3.5 shrink-0" /> {t("comments.agentHint")}
          </p>
        )}
        <div className="flex items-center gap-2">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
          <span className="ml-auto hidden text-xs text-muted sm:inline">{t("comments.hint")}</span>
          <button type="button" className="btn btn-ghost" disabled={pending || !draft.trim()} onClick={submit}>
            {t("comments.add")}
          </button>
        </div>
      </div>
    </section>
  );
}
