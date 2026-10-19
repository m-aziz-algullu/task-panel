"use client";

import { Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createRoutine, deleteRoutine, updateRoutine } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { MAX_ROUTINE_BODY_LENGTH, type Routine, type RoutineInput } from "@/lib/types";
import { COLUMN_WIDTH } from "./card-size";
import { Markdown } from "./markdown";
import { Modal } from "./modal";

/** Recurring chores, kept at the end of the board; not tasks, so nothing is dragged here. */
export function RoutinesColumn({ routines, onOpen, onAdd }: { routines: Routine[]; onOpen: (routine: Routine) => void; onAdd: () => void }) {
  const { t } = useI18n();

  return (
    <section
      className="flex max-h-full shrink-0 flex-col rounded-xl border border-dashed border-border bg-surface-2/60"
      style={{ width: COLUMN_WIDTH }}
      aria-label={t("routines.title")}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Repeat className="size-3.5 text-muted" />
        <h2 className="text-sm font-semibold">{t("routines.title")}</h2>
        <span className="rounded-full bg-surface px-2 text-xs font-medium text-muted">{routines.length}</span>
        <button type="button" className="icon-btn ml-auto size-7" title={t("routines.add")} onClick={onAdd}>
          <Plus className="size-4" />
        </button>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {routines.map((routine) => (
          <button
            key={routine.id}
            type="button"
            onClick={() => onOpen(routine)}
            className="rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-colors outline-none hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <p className="text-sm leading-snug font-medium break-words">{routine.title}</p>
            {routine.body && (
              <p className="mt-1 line-clamp-2 text-xs break-words whitespace-pre-line text-muted">{routine.body}</p>
            )}
          </button>
        ))}
        {routines.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
            {t("routines.empty")}
          </div>
        )}
      </div>
    </section>
  );
}

function RoutineForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: RoutineInput;
  submitLabel: string;
  onSubmit: (draft: RoutineInput) => Promise<MessageKey | null>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(await onSubmit(draft));
    });

  return (
    <form
      className="flex flex-col gap-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && draft.title.trim()) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <input
        className="input"
        placeholder={t("routines.titlePlaceholder")}
        value={draft.title}
        maxLength={300}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        autoFocus
      />
      <textarea
        className="input min-h-48 resize-y font-mono text-sm"
        placeholder={t("routines.bodyPlaceholder")}
        value={draft.body}
        maxLength={MAX_ROUTINE_BODY_LENGTH}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">{t("task.saveHint")}</span>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t("common.discard")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || !draft.title.trim()}>
          {pending ? t("common.saving") : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Shows a routine's notes, with edit and delete; with no routine, a form for a new one. */
export function RoutineDialog({ routine, onClose }: { routine?: Routine; onClose: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(!routine);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  if (!routine) {
    return (
      <Modal title={t("routines.new")} onClose={onClose}>
        <RoutineForm
          initial={{ title: "", body: "" }}
          submitLabel={t("common.create")}
          onCancel={onClose}
          onSubmit={async (draft) => {
            const result = await createRoutine(draft);
            if (!result.ok) return result.error;
            onClose();
            return null;
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={editing ? t("common.edit") : routine.title} onClose={onClose}>
      {editing ? (
        <RoutineForm
          initial={{ title: routine.title, body: routine.body }}
          submitLabel={t("common.save")}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            const result = await updateRoutine(routine.id, draft);
            if (!result.ok) return result.error;
            setEditing(false);
            return null;
          }}
        />
      ) : (
        <div className="flex flex-col gap-4 p-5">
          {routine.body ? <Markdown>{routine.body}</Markdown> : <p className="text-sm text-muted">{t("routines.noNotes")}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              className="btn btn-ghost hover:text-red-600"
              disabled={pending}
              onClick={() => {
                if (!confirm(t("routines.deleteConfirm", { title: routine.title }))) return;
                startTransition(async () => {
                  const result = await deleteRoutine(routine.id);
                  if (result.ok) onClose();
                  else setError(result.error);
                });
              }}
            >
              <Trash2 className="size-4" /> {t("common.delete")}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> {t("common.edit")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
