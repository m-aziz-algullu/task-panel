import { Bot, CalendarDays, Clock, Flag, LoaderCircle } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { formatDay } from "@/lib/dates";
import { dueAlert, type DueAlert } from "@/lib/due-date";
import type { Tag, Task } from "@/lib/types";
import { TagPill } from "./tag-pill";

type TaskCardProps = {
  task: Task;
  tagsById: Map<number, Tag>;
  today: string;
  lifted?: boolean;
};

/** Across the card's top while the agent has the task, so it stands out on a busy board. */
function AgentBanner({ status }: { status: "queued" | "running" }) {
  const { t } = useI18n();
  const running = status === "running";
  const Icon = running ? LoaderCircle : Clock;
  return (
    <div
      className={`-mx-3 -mt-3 mb-2 flex items-center gap-1.5 rounded-t-[7px] px-3 py-1.5 text-xs font-semibold ${
        running ? "bg-agent text-white dark:text-gray-950" : "bg-agent/15 text-agent"
      }`}
    >
      <Bot className="size-3.5" />
      <span>{t(running ? "agentRun.cardRunning" : "agentRun.cardQueued")}</span>
      <Icon className={`ml-auto size-3.5 ${running ? "animate-spin" : ""}`} aria-hidden />
    </div>
  );
}

/** A glowing, pulsing dot: the reminder that the due date is near or past. */
function DueLight({ kind }: { kind: DueAlert["kind"] }) {
  const color = kind === "overdue" ? "bg-overdue shadow-overdue" : "bg-due-soon shadow-due-soon";
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className={`absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping ${color}`} />
      <span className={`relative inline-flex size-2 rounded-full shadow-[0_0_6px] ${color}`} />
    </span>
  );
}

function DueDate({ dueDate, alert, label }: { dueDate: string; alert: DueAlert | null; label: string }) {
  const { t } = useI18n();
  const title = !alert
    ? `${t("card.due")}: ${dueDate}`
    : alert.kind === "overdue"
      ? t("card.dueOverdue", { count: alert.daysLate })
      : alert.daysLeft === 0
        ? t("card.dueToday")
        : t("card.dueSoon", { count: alert.daysLeft });
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        alert?.kind === "overdue" ? "font-semibold text-overdue" : alert ? "font-semibold text-due-soon" : ""
      }`}
      title={title}
      aria-label={alert ? title : undefined}
    >
      {alert ? <DueLight kind={alert.kind} /> : <Flag className="size-3.5" />}
      {label}
    </span>
  );
}

export function TaskCard({ task, tagsById, today, lifted }: TaskCardProps) {
  const taskTags = task.tagIds.map((id) => tagsById.get(id)).filter((tag): tag is Tag => Boolean(tag));
  const overdue = task.status !== "done" && task.day < today;
  const { t, intlLocale } = useI18n();
  const dayLabels = { today: t("days.today"), tomorrow: t("days.tomorrow"), yesterday: t("days.yesterday") };
  const agent = task.agentRun === "queued" || task.agentRun === "running" ? task.agentRun : null;
  const alert = dueAlert(task, today);

  return (
    <div
      className={`rounded-lg border bg-surface p-3 text-left transition-colors ${
        lifted
          ? "rotate-1 border-accent shadow-xl"
          : agent === "running"
            ? "border-agent shadow-md ring-2 ring-agent/30"
            : agent === "queued"
              ? "border-agent/60 border-dashed shadow-sm"
              : "border-border shadow-sm hover:border-accent/60"
      }`}
    >
      {agent && !lifted && <AgentBanner status={agent} />}
      {taskTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {taskTags.map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
        </div>
      )}
      <p className="text-sm leading-snug font-medium break-words">{task.title}</p>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs break-words whitespace-pre-line text-muted">{task.description}</p>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span
          className={`inline-flex items-center gap-1 ${overdue ? "font-semibold text-overdue" : ""}`}
          title={overdue ? t("card.overdue") : t("card.day")}
        >
          <CalendarDays className="size-3.5" />
          {formatDay(task.day, today, dayLabels, intlLocale)}
        </span>
        <DueDate dueDate={task.dueDate} alert={alert} label={formatDay(task.dueDate, today, dayLabels, intlLocale)} />
        <span className="ml-auto font-mono text-[11px]">#{task.id}</span>
        {task.storyPoints != null && (
          <span
            className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-fg"
            title={t("card.storyPoints")}
          >
            {task.storyPoints} SP
          </span>
        )}
      </div>
    </div>
  );
}
