"use client";

import { Bot, Info, MessageSquare, SendHorizontal, Trash2, User } from "lucide-react";
import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { addComment, deleteComment } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey, Translate, Vars } from "@/i18n/translate";
import { parseSystemComment } from "@/lib/agent/system-comments";
import { formatDateTime } from "@/lib/dates";
import { MAX_COMMENT_LENGTH, type CommentAuthor, type TaskComment } from "@/lib/types";
import { Markdown } from "./markdown";

const AUTHOR_META: Record<CommentAuthor, { label: MessageKey; icon: typeof User; className: string }> = {
  user: { label: "comments.you", icon: User, className: "bg-accent/15 text-accent" },
  agent: { label: "comments.agent", icon: Bot, className: "bg-agent/15 text-agent" },
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

function Avatar({ author }: { author: CommentAuthor }) {
  const { icon: Icon, className } = AUTHOR_META[author];
  return (
    <span className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ${className}`}>
      <Icon className="size-3.5" />
    </span>
  );
}

type TaskCommentsProps = {
  taskId: number;
  timeZone: string;
  /** Loaded by the dialog together with the agent run (null while loading). */
  comments: TaskComment[] | null;
  setComments: Dispatch<SetStateAction<TaskComment[] | null>>;
  loadFailed: boolean;
  /** After a comment is added: the agent may have picked it up. */
  onAdded: () => void;
  /** Whether an unsent comment is typed, so saving the task can warn before dropping it. */
  onDraftChange: (hasDraft: boolean) => void;
};

export function TaskComments({
  taskId,
  timeZone,
  comments,
  setComments,
  loadFailed,
  onAdded,
  onDraftChange,
}: TaskCommentsProps) {
  const { t, intlLocale } = useI18n();
  const [draft, setDraftState] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  const setDraft = (value: string) => {
    setDraftState(value);
    onDraftChange(value.trim() !== "");
  };

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
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-muted">
        <MessageSquare className="size-3.5" />
        {t("comments.title")}
        {comments && comments.length > 0 && (
          <span className="rounded-full bg-surface-2 px-1.5 py-px tabular-nums">{comments.length}</span>
        )}
      </h3>

      {loadFailed && !comments && <p className="text-xs text-red-600 dark:text-red-400">{t("comments.loadError")}</p>}
      {comments?.length === 0 && <p className="text-xs text-muted">{t("comments.empty")}</p>}
      {comments && comments.length > 0 && (
        <ol className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="group flex gap-2.5">
              <Avatar author={comment.author} />
              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{t(AUTHOR_META[comment.author].label)}</span>
                  <time className="text-muted" dateTime={comment.createdAt}>
                    {formatDateTime(comment.createdAt, timeZone, intlLocale)}
                  </time>
                  <button
                    type="button"
                    className="icon-btn -my-1 -mr-1.5 ml-auto size-6 opacity-0 group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 dark:hover:text-red-400"
                    aria-label={t("comments.delete")}
                    title={t("comments.delete")}
                    disabled={pending}
                    onClick={() => remove(comment.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {comment.author === "agent" ? (
                  <Markdown>{comment.body}</Markdown>
                ) : (
                  <p className="text-sm break-words whitespace-pre-wrap">{commentText(comment, t, intlLocale)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex gap-2.5">
        <Avatar author="user" />
        {/* The field and its send button share one box, so it reads apart from the task's own Save. */}
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <textarea
            className="block max-h-60 min-h-16 w-full resize-y bg-transparent px-3 pt-2 text-sm text-fg outline-none placeholder:text-muted"
            rows={2}
            placeholder={t("comments.placeholder")}
            aria-label={t("comments.placeholder")}
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
          <div className="flex items-center gap-2 px-2 pb-2">
            {error ? (
              <p className="px-1 text-xs text-red-600 dark:text-red-400">{t(error)}</p>
            ) : (
              <span className="hidden px-1 text-xs text-muted sm:inline">{t("comments.hint")}</span>
            )}
            <button
              type="button"
              className="btn btn-primary ml-auto px-2.5 py-1 text-xs"
              disabled={pending || !draft.trim()}
              onClick={submit}
            >
              <SendHorizontal className="size-3.5" />
              {t("comments.add")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
