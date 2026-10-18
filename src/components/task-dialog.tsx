"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createTag, createTask, deleteTask, updateTask } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { addDays, formatDateTime, formatDay } from "@/lib/dates";
import { STATUSES, STATUS_META, STORY_POINTS, type Clock, type Status, type Tag, type Task, type TaskInput } from "@/lib/types";
import { plainTextToDocument } from "@/lib/rich-text/document";
import { ColorPicker, randomPresetColor } from "./color-picker";
import { Modal } from "./modal";
import { RichTextEditor } from "./rich-text/editor";
import { TagPill } from "./tag-pill";
import { AgentRunPanel } from "./agent-run-panel";
import { TaskComments } from "./task-comments";
import { useTaskActivity } from "./use-task-activity";

type TaskDialogProps = {
  task?: Task;
  defaultStatus?: Status;
  tags: Tag[];
  clock: Clock;
  /** The bundled OpenClaw agent is set up, so tasks can be handed to it. */
  agent?: boolean;
  onClose: () => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
    </div>
  );
}

function InlineTagCreator({ onCreated }: { onCreated: (tag: Tag) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(randomPresetColor);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost -ml-2 self-start text-muted" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {t("task.newTag")}
      </button>
    );
  }

  const submit = () =>
    startTransition(async () => {
      const result = await createTag({ name, color });
      if (!result.ok) return setError(result.error);
      onCreated(result.data);
      setName("");
      setColor(randomPresetColor());
      setError(null);
      setOpen(false);
    });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <input
        className="input"
        placeholder={t("tags.name")}
        value={name}
        maxLength={40}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (name.trim()) submit();
          }
        }}
      />
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          {t("common.discard")}
        </button>
        <button type="button" className="btn btn-primary" disabled={pending || !name.trim()} onClick={submit}>
          {t("common.create")}
        </button>
      </div>
    </div>
  );
}

/** Comments and the agent panel of a saved task; they share one polled feed. */
function TaskActivity({ task, clock, agent }: { task: Task; clock: Clock; agent: boolean }) {
  const { comments, setComments, run, failed, reload } = useTaskActivity(task.id);
  return (
    <>
      {agent && <AgentRunPanel taskId={task.id} run={run} onChange={() => void reload()} />}
      <TaskComments
        taskId={task.id}
        timeZone={clock.timeZone}
        comments={comments}
        setComments={setComments}
        loadFailed={failed}
        toAgent={agent && run != null && task.status !== "done"}
        onAdded={() => void reload()}
      />
    </>
  );
}

export function TaskDialog({ task, defaultStatus = "backlog", tags, clock, agent = false, onClose }: TaskDialogProps) {
  const [form, setForm] = useState<TaskInput>(() => ({
    title: task?.title ?? "",
    // Tasks saved before the editor existed only have plain text.
    descriptionDoc: task?.descriptionDoc ?? plainTextToDocument(task?.description ?? ""),
    status: task?.status ?? defaultStatus,
    storyPoints: task?.storyPoints ?? null,
    day: task?.day ?? clock.today,
    completedDay: task?.completedDay ?? clock.today,
    tagIds: task?.tagIds ?? [],
  }));
  const { t, intlLocale } = useI18n();
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();
  const dayLabels = { today: t("days.today"), tomorrow: t("days.tomorrow"), yesterday: t("days.yesterday") };

  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleTag = (id: number) =>
    set("tagIds", form.tagIds.includes(id) ? form.tagIds.filter((t) => t !== id) : [...form.tagIds, id]);

  const save = () => {
    if (!form.title.trim()) return setError("errors.titleRequired");
    startTransition(async () => {
      const result = task ? await updateTask(task.id, form) : await createTask(form);
      if (!result.ok) return setError(result.error);
      onClose();
    });
  };

  const remove = () => {
    if (!task || !confirm(t("task.deleteConfirm", { title: task.title }))) return;
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if (!result.ok) return setError(result.error);
      onClose();
    });
  };

  return (
    <Modal title={task ? t("task.heading", { id: task.id }) : t("task.new")} onClose={onClose} size="lg">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
        className="flex flex-col"
      >
        <div className="grid gap-6 p-5 md:grid-cols-[1fr_16.5rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <textarea
              className="input resize-none text-base font-semibold"
              placeholder={t("task.titlePlaceholder")}
              rows={2}
              value={form.title}
              maxLength={300}
              autoFocus={!task}
              onChange={(event) => set("title", event.target.value.replace(/\n/g, " "))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) event.preventDefault();
              }}
            />
            <Field label={t("task.description")}>
              <RichTextEditor
                initialContent={form.descriptionDoc}
                onChange={(doc) => set("descriptionDoc", doc)}
                placeholder={t("task.descriptionPlaceholder")}
                label={t("task.description")}
              />
            </Field>
            {task && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
                <dt>{t("task.created")}</dt>
                <dd>{formatDateTime(task.createdAt, clock.timeZone, intlLocale)}</dd>
                {task.completedAt && (
                  <>
                    <dt>{t("task.completed")}</dt>
                    <dd>{formatDateTime(task.completedAt, clock.timeZone, intlLocale)}</dd>
                  </>
                )}
              </dl>
            )}
            {task && <TaskActivity task={task} clock={clock} agent={agent} />}
          </div>

          <div className="flex flex-col gap-5">
            <Field label={t("task.status")}>
              <select
                className="input"
                value={form.status}
                onChange={(event) => set("status", event.target.value as Status)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_META[status].label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={`${t("task.day")} · ${formatDay(form.day, clock.today, dayLabels, intlLocale)}`}>
              <input
                type="date"
                className="input"
                value={form.day}
                required
                onChange={(event) => event.target.value && set("day", event.target.value)}
              />
              <div className="flex gap-1">
                {[
                  { label: t("days.today"), value: clock.today },
                  { label: t("days.tomorrow"), value: addDays(clock.today, 1) },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`btn px-2 py-1 text-xs ${form.day === option.value ? "bg-surface-2 text-fg" : "btn-ghost text-muted"}`}
                    onClick={() => set("day", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>

            {form.status === "done" && (
              <Field
                label={`${t("task.completedDay")} · ${formatDay(form.completedDay ?? clock.today, clock.today, dayLabels, intlLocale)}`}
              >
                <input
                  type="date"
                  className="input"
                  value={form.completedDay ?? clock.today}
                  max={clock.today}
                  required
                  onChange={(event) =>
                    event.target.value && event.target.value <= clock.today && set("completedDay", event.target.value)
                  }
                />
                <div className="flex gap-1">
                  {[
                    { label: t("days.today"), value: clock.today },
                    { label: t("days.yesterday"), value: addDays(clock.today, -1) },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={`btn px-2 py-1 text-xs ${(form.completedDay ?? clock.today) === option.value ? "bg-surface-2 text-fg" : "btn-ghost text-muted"}`}
                      onClick={() => set("completedDay", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label={t("task.storyPoints")}>
              <div className="flex flex-wrap gap-1">
                {STORY_POINTS.map((points) => (
                  <button
                    key={points}
                    type="button"
                    aria-pressed={form.storyPoints === points}
                    onClick={() => set("storyPoints", form.storyPoints === points ? null : points)}
                    className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold transition ${
                      form.storyPoints === points
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-border hover:bg-surface-2"
                    }`}
                  >
                    {points}
                  </button>
                ))}
              </div>
              {form.storyPoints != null && (
                <button
                  type="button"
                  className="self-start text-xs text-muted hover:text-fg"
                  onClick={() => set("storyPoints", null)}
                >
                  {t("task.removePoints")}
                </button>
              )}
            </Field>

            <Field label={t("task.tags")}>
              {tags.length === 0 && <p className="text-xs text-muted">{t("task.noTags")}</p>}
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = form.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag.id)}
                      className={`cursor-pointer rounded-full transition ${selected ? "" : "opacity-35 grayscale-[40%] hover:opacity-70"}`}
                    >
                      <TagPill tag={tag} size="md" />
                    </button>
                  );
                })}
              </div>
              <InlineTagCreator onCreated={(tag) => set("tagIds", [...form.tagIds, tag.id])} />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          {task && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={pending}>
              <Trash2 className="size-4" /> {t("common.delete")}
            </button>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
          <span className="ml-auto hidden text-xs text-muted sm:inline">{t("task.saveHint")}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? t("common.saving") : task ? t("common.save") : t("common.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
