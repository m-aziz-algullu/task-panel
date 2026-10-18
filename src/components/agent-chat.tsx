"use client";

import { Bot, FileText, Paperclip, SendHorizontal, Square, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { chatFilesError, MAX_CHAT_MESSAGE_LENGTH } from "@/lib/agent/chat-shape";
import { Markdown } from "./markdown";

type ChatMessage =
  | { id: number; role: "user"; text: string; files: string[] }
  | { id: number; role: "agent"; text: string }
  | { id: number; role: "notice"; text: string };

// Omit applied to each kind of message, so each keeps its own fields.
type NewMessage = ChatMessage extends infer M ? (M extends unknown ? Omit<M, "id"> : never) : never;

type TurnState =
  | { status: "running" }
  | { status: "done"; reply: string | null }
  | { status: "failed"; error: string }
  | { status: "aborted" };

/** The browser gives up on a turn a little after the agent's own 30 minute limit. */
const TURN_DEADLINE_MS = 31 * 60_000;

let nextId = 1;

async function errorKey(response: Response): Promise<MessageKey> {
  try {
    const body = (await response.json()) as { error?: MessageKey };
    return body.error ?? "errors.generic";
  } catch {
    return "errors.generic";
  }
}

/**
 * The chat with the agent, bottom right on every panel page. Each time it opens
 * it is a new OpenClaw session: nothing of earlier chats is shown, while what the
 * agent saved to its memory carries over, to later chats and to task runs alike.
 */
export function AgentChat() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  // Bumped on every new chat, so answers to an earlier one are dropped.
  const chat = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const push = (message: NewMessage) =>
    setMessages((current) => [...current, { ...message, id: nextId++ } as ChatMessage]);

  const reset = () => {
    chat.current++;
    setMessages([]);
    setSessionKey(null);
    setRunId(null);
    setDraft("");
    setFiles([]);
    setSending(false);
    setError(null);
  };

  const close = () => {
    // A turn still running finishes on its own: the agent may be saving to its memory.
    reset();
    setOpen(false);
  };

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, runId]);

  useEffect(() => {
    if (open) textarea.current?.focus();
  }, [open, runId]);

  // Follows the running turn until the agent answers.
  useEffect(() => {
    if (!runId || !sessionKey) return;
    const controller = new AbortController();
    const current = chat.current;
    const deadline = Date.now() + TURN_DEADLINE_MS;
    const url = `/api/agent/chat/${encodeURIComponent(runId)}?session=${encodeURIComponent(sessionKey)}`;
    const settle = (message: NewMessage) => {
      if (chat.current !== current) return;
      push(message);
      setRunId(null);
    };
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted && Date.now() < deadline) {
        let state: TurnState;
        try {
          const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) {
            if (response.status === 400 || response.status === 401 || ++failures >= 5) {
              return settle({ role: "notice", text: t(await errorKey(response)) });
            }
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            continue;
          }
          failures = 0;
          state = (await response.json()) as TurnState;
        } catch {
          if (controller.signal.aborted) return;
          if (++failures >= 5) return settle({ role: "notice", text: t("errors.agentUnavailable") });
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          continue;
        }
        if (state.status === "running") continue;
        if (state.status === "done") {
          return settle(state.reply ? { role: "agent", text: state.reply } : { role: "notice", text: t("chat.noReply") });
        }
        if (state.status === "aborted") return settle({ role: "notice", text: t("chat.stopped") });
        return settle({ role: "notice", text: t("chat.failed", { error: state.error }) });
      }
    })();
    return () => controller.abort();
    // `t` changes only with the language; a running turn keeps its wording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, sessionKey]);

  const busy = sending || runId != null;

  const send = async () => {
    if (busy || (!draft.trim() && files.length === 0)) return;
    const fileError = chatFilesError(files);
    if (fileError) return setError(`errors.${fileError}`);
    const current = chat.current;
    const form = new FormData();
    form.set("message", draft);
    if (sessionKey) form.set("sessionKey", sessionKey);
    for (const file of files) form.append("files", file);
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/chat", { method: "POST", body: form });
      if (chat.current !== current) return;
      if (!response.ok) return setError(await errorKey(response));
      const turn = (await response.json()) as { sessionKey: string; runId: string };
      push({ role: "user", text: draft.trim(), files: files.map((file) => file.name) });
      setDraft("");
      setFiles([]);
      setSessionKey(turn.sessionKey);
      setRunId(turn.runId);
    } catch {
      if (chat.current === current) setError("errors.agentUnavailable");
    } finally {
      if (chat.current === current) setSending(false);
    }
  };

  const stop = async () => {
    if (!runId || !sessionKey) return;
    try {
      await fetch(`/api/agent/chat/${encodeURIComponent(runId)}?session=${encodeURIComponent(sessionKey)}`, {
        method: "DELETE",
      });
    } catch {
      // The wait loop reports how the turn ended either way.
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    setFiles(next);
    const fileError = chatFilesError(next);
    setError(fileError ? `errors.${fileError}` : null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 inline-flex size-13 cursor-pointer items-center justify-center rounded-full bg-agent text-white shadow-lg shadow-agent/30 transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
        aria-label={t("chat.open")}
        title={t("chat.open")}
      >
        <Bot className="size-6" />
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label={t("chat.title")}
      className="fixed inset-x-2 top-16 bottom-2 z-40 flex flex-col overflow-hidden rounded-xl border-2 border-agent/60 bg-surface shadow-2xl sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:h-[min(36rem,calc(100dvh-6rem))] sm:w-[24rem]"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <header className="flex items-center gap-2 border-b border-border bg-agent/10 px-3 py-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-agent text-white">
          <Bot className="size-4" />
        </span>
        <span className="font-semibold">{t("chat.title")}</span>
        <button
          type="button"
          className="icon-btn ml-auto"
          onClick={reset}
          disabled={messages.length === 0 && !busy}
          aria-label={t("chat.newChat")}
          title={t("chat.newChat")}
        >
          <SquarePen className="size-4" />
        </button>
        <button type="button" className="icon-btn" onClick={close} aria-label={t("chat.close")} title={t("chat.close")}>
          <X className="size-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.length === 0 && !busy && (
          <div className="m-auto flex max-w-72 flex-col items-center gap-2 text-center text-xs text-muted">
            <Bot className="size-8 text-agent" />
            <p>{t("chat.subtitle")}</p>
            <p>{t("chat.empty")}</p>
          </div>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex max-w-[85%] flex-col items-end gap-1 self-end">
              {message.files.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {message.files.map((name, index) => (
                    <span
                      key={index}
                      className="inline-flex max-w-48 items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs"
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                  ))}
                </div>
              )}
              {message.text && (
                <p className="rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm break-words whitespace-pre-wrap text-accent-fg">
                  {message.text}
                </p>
              )}
            </div>
          ) : message.role === "agent" ? (
            <div key={message.id} className="max-w-[92%] self-start rounded-xl rounded-bl-sm bg-surface-2 px-3 py-2">
              <Markdown>{message.text}</Markdown>
            </div>
          ) : (
            <p key={message.id} className="self-center text-center text-xs text-muted">
              {message.text}
            </p>
          ),
        )}
        {runId && (
          <div className="flex items-center gap-2 self-start text-xs font-medium text-agent">
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="size-1.5 animate-bounce rounded-full bg-agent [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-agent [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-agent" />
            </span>
            {t("chat.thinking")}
            <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => void stop()}>
              <Square className="size-3" /> {t("chat.stop")}
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-2">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex max-w-48 items-center gap-1 rounded-md border border-border bg-surface-2 py-0.5 pr-0.5 pl-1.5 text-xs"
              >
                <FileText className="size-3 shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="icon-btn size-5"
                  aria-label={t("chat.removeFile", { name: file.name })}
                  onClick={() => {
                    const next = files.filter((_, i) => i !== index);
                    setFiles(next);
                    const fileError = chatFilesError(next);
                    setError(fileError ? `errors.${fileError}` : null);
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
        <div className="flex items-end gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            aria-label={t("chat.attach")}
            title={t("chat.attach")}
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            ref={textarea}
            className="input max-h-40 min-h-9 flex-1 resize-none text-sm"
            rows={1}
            placeholder={t("chat.placeholder")}
            title={t("chat.hint")}
            value={draft}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            onChange={(event) => {
              setDraft(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${event.target.scrollHeight}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="icon-btn shrink-0 bg-agent text-white hover:bg-agent/85 disabled:opacity-40"
            onClick={() => void send()}
            disabled={busy || (!draft.trim() && files.length === 0)}
            aria-label={t("chat.send")}
            title={t("chat.send")}
          >
            <SendHorizontal className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
