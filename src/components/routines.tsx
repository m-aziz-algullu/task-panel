"use client";

import { Bot, CalendarClock, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createRoutine, deleteRoutine, runRoutineNow, updateRoutine } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey, Translate } from "@/i18n/translate";
import { formatDateTime } from "@/lib/dates";
import { MAX_CRON_LENGTH, WEEKDAYS, type RoutineSchedule } from "@/lib/routine-schedule";
import { MAX_ROUTINE_BODY_LENGTH, type Clock, type Routine, type RoutineInput } from "@/lib/types";
import { COLUMN_WIDTH } from "./card-size";
import { Markdown } from "./markdown";
import { Modal } from "./modal";

/** Short weekday name; 2026-01-04 was a Sunday, so day `d` (0 = Sunday) is the 4th + d. */
function weekdayName(day: number, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)));
}

/** e.g. "Every day at 08:00", "Mon, Wed at 07:30", "Cron: 0 8 * * 1-5". */
export function describeSchedule(schedule: RoutineSchedule, t: Translate, intlLocale: string): string {
  switch (schedule.kind) {
    case "daily":
      return t("routines.dailyAt", { time: schedule.time });
    case "weekly": {
      const days = WEEKDAYS.filter((day) => schedule.days.includes(day)).map((day) => weekdayName(day, intlLocale));
      return t("routines.weeklyAt", { days: days.join(", "), time: schedule.time });
    }
    case "cron":
      return t("routines.cronSummary", { expression: schedule.expression });
  }
}

/** Refreshes the board shortly after the next scheduled routine fires, so its task shows up. */
function useRoutineRefresh(routines: Routine[]) {
  const router = useRouter();
  const next = routines.reduce<string | null>(
    (soonest, routine) => (routine.nextRunAt && (!soonest || routine.nextRunAt < soonest) ? routine.nextRunAt : soonest),
    null,
  );
  useEffect(() => {
    if (!next) return;
    // A few seconds' slack for the scheduler; setTimeout can't wait longer than ~24 days.
    const delay = Math.min(Math.max(new Date(next).getTime() - Date.now(), 0) + 3_000, 2 ** 31 - 1);
    const timer = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(timer);
  }, [next, router]);
}

/** Recurring chores, kept at the end of the board; not tasks, so nothing is dragged here. */
export function RoutinesColumn({ routines, onOpen, onAdd }: { routines: Routine[]; onOpen: (routine: Routine) => void; onAdd: () => void }) {
  const { t, intlLocale } = useI18n();
  useRoutineRefresh(routines);

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
            {routine.schedule && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                <CalendarClock className="size-3 shrink-0" />
                <span className="truncate">{describeSchedule(routine.schedule, t, intlLocale)}</span>
                {routine.handToAgent && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-agent" title={t("routines.handToAgent")}>
                    <Bot className="size-3" /> {t("routines.agentBadge")}
                  </span>
                )}
              </p>
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

type ScheduleKind = RoutineSchedule["kind"] | "none";

/** Every kind's fields at once, so switching kinds in the form doesn't lose what was typed. */
type ScheduleDraft = { kind: ScheduleKind; time: string; days: number[]; expression: string };

function scheduleDraft(schedule: RoutineSchedule | null): ScheduleDraft {
  return {
    kind: schedule?.kind ?? "none",
    time: schedule && schedule.kind !== "cron" ? schedule.time : "09:00",
    days: schedule?.kind === "weekly" ? schedule.days : [1, 2, 3, 4, 5],
    expression: schedule?.kind === "cron" ? schedule.expression : "",
  };
}

function scheduleFrom(draft: ScheduleDraft): RoutineSchedule | null {
  switch (draft.kind) {
    case "none":
      return null;
    case "daily":
      return { kind: "daily", time: draft.time };
    case "weekly":
      return { kind: "weekly", time: draft.time, days: draft.days };
    case "cron":
      return { kind: "cron", expression: draft.expression };
  }
}

function ScheduleFields({
  draft,
  onChange,
  timeZone,
}: {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  timeZone: string;
}) {
  const { t, intlLocale } = useI18n();
  const kinds: { value: ScheduleKind; label: string }[] = [
    { value: "none", label: t("routines.scheduleNone") },
    { value: "daily", label: t("routines.scheduleDaily") },
    { value: "weekly", label: t("routines.scheduleWeekly") },
    { value: "cron", label: t("routines.scheduleCron") },
  ];
  const toggleDay = (day: number) =>
    onChange({ ...draft, days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day] });

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted">{t("routines.schedule")}</legend>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("routines.schedule")}>
        {kinds.map((kind) => (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind.value}
            onClick={() => onChange({ ...draft, kind: kind.value })}
            className={`btn px-2 py-1 text-xs ${draft.kind === kind.value ? "btn-primary" : "btn-ghost border border-border"}`}
          >
            {kind.label}
          </button>
        ))}
      </div>
      {draft.kind === "weekly" && (
        <div className="flex flex-wrap gap-1" aria-label={t("routines.weekdays")}>
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={draft.days.includes(day)}
              onClick={() => toggleDay(day)}
              className={`btn min-w-11 px-2 py-1 text-xs ${draft.days.includes(day) ? "btn-primary" : "btn-ghost border border-border"}`}
            >
              {weekdayName(day, intlLocale)}
            </button>
          ))}
        </div>
      )}
      {(draft.kind === "daily" || draft.kind === "weekly") && (
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("routines.time")}
          <input
            type="time"
            className="input w-auto py-1 text-sm"
            value={draft.time}
            required
            onChange={(event) => onChange({ ...draft, time: event.target.value })}
          />
          <span>{timeZone}</span>
        </label>
      )}
      {draft.kind === "cron" && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          <input
            className="input font-mono text-sm"
            placeholder={t("routines.cronPlaceholder")}
            value={draft.expression}
            maxLength={MAX_CRON_LENGTH}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, expression: event.target.value })}
          />
          {t("routines.cronHelp", { timeZone })}
        </label>
      )}
      {draft.kind !== "none" && <p className="text-[11px] text-muted">{t("routines.scheduleHint")}</p>}
    </fieldset>
  );
}

function RoutineForm({
  initial,
  submitLabel,
  agent,
  timeZone,
  onSubmit,
  onCancel,
}: {
  initial: RoutineInput;
  submitLabel: string;
  /** The agent is available, so scheduled tasks can be handed to it. */
  agent: boolean;
  timeZone: string;
  onSubmit: (draft: RoutineInput) => Promise<MessageKey | null>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [schedule, setSchedule] = useState(() => scheduleDraft(initial.schedule));
  const [handToAgent, setHandToAgent] = useState(initial.handToAgent);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(await onSubmit({ title, body, schedule: scheduleFrom(schedule), handToAgent }));
    });

  return (
    <form
      className="flex flex-col gap-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && title.trim()) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <input
        className="input"
        placeholder={t("routines.titlePlaceholder")}
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      <textarea
        className="input min-h-40 resize-y font-mono text-sm"
        placeholder={t("routines.bodyPlaceholder")}
        value={body}
        maxLength={MAX_ROUTINE_BODY_LENGTH}
        onChange={(event) => setBody(event.target.value)}
      />
      <ScheduleFields draft={schedule} onChange={setSchedule} timeZone={timeZone} />
      {/* Kept visible while it's on, so it can be turned off even with the agent disabled. */}
      {schedule.kind !== "none" && (agent || handToAgent) && (
        <label className="flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--agent)]"
            checked={handToAgent}
            onChange={(event) => setHandToAgent(event.target.checked)}
          />
          <span>
            {t("routines.handToAgent")}
            <span className="block text-[11px]">{t("routines.handToAgentHint")}</span>
          </span>
        </label>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">{t("task.saveHint")}</span>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t("common.discard")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || !title.trim()}>
          {pending ? t("common.saving") : submitLabel}
        </button>
      </div>
    </form>
  );
}

const EMPTY_ROUTINE: RoutineInput = { title: "", body: "", schedule: null, handToAgent: false };

/** Shows a routine's notes and schedule, with edit, delete and "run now"; with no routine, a form for a new one. */
export function RoutineDialog({
  routine,
  clock,
  agent,
  onClose,
}: {
  routine?: Routine;
  clock: Clock;
  agent: boolean;
  onClose: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const [editing, setEditing] = useState(!routine);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!routine) {
    return (
      <Modal title={t("routines.new")} onClose={onClose}>
        <RoutineForm
          initial={EMPTY_ROUTINE}
          submitLabel={t("common.create")}
          agent={agent}
          timeZone={clock.timeZone}
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

  const when = (iso: string) => formatDateTime(iso, clock.timeZone, intlLocale);

  return (
    <Modal title={editing ? t("common.edit") : routine.title} onClose={onClose}>
      {editing ? (
        <RoutineForm
          initial={routine}
          submitLabel={t("common.save")}
          agent={agent}
          timeZone={clock.timeZone}
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
          {routine.schedule && (
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2/60 p-3 text-xs text-muted">
              <p className="flex items-center gap-1.5 font-medium text-fg">
                <CalendarClock className="size-3.5" />
                {describeSchedule(routine.schedule, t, intlLocale)}
                {routine.handToAgent && (
                  <span className="ml-auto inline-flex items-center gap-1 text-agent">
                    <Bot className="size-3.5" /> {t("routines.agentBadge")}
                  </span>
                )}
              </p>
              {routine.nextRunAt && <p>{t("routines.nextRun", { when: when(routine.nextRunAt) })}</p>}
              {routine.lastRunAt && <p>{t("routines.lastRun", { when: when(routine.lastRunAt) })}</p>}
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
          {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
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
            <button
              type="button"
              className="btn btn-outline mr-auto"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  setNotice(null);
                  const result = await runRoutineNow(routine.id);
                  if (result.ok) setNotice(t("routines.created", { id: result.data.taskId }));
                  else setError(result.error);
                })
              }
            >
              <Play className="size-4" /> {t("routines.runNow")}
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
