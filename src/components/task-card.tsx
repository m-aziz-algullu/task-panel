import { Bot, CalendarDays } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { formatDay } from "@/lib/dates";
import type { Tag, Task } from "@/lib/types";
import { TagPill } from "./tag-pill";

type TaskCardProps = {
  task: Task;
  tagsById: Map<number, Tag>;
  today: string;
  lifted?: boolean;
};

export function TaskCard({ task, tagsById, today, lifted }: TaskCardProps) {
  const taskTags = task.tagIds.map((id) => tagsById.get(id)).filter((tag): tag is Tag => Boolean(tag));
  const overdue = task.status !== "done" && task.day < today;
  const { t, intlLocale } = useI18n();
  const dayLabels = { today: t("days.today"), tomorrow: t("days.tomorrow"), yesterday: t("days.yesterday") };

  return (
    <div
      className={`rounded-lg border bg-surface p-3 text-left transition-colors ${
        lifted ? "rotate-1 border-accent shadow-xl" : "border-border shadow-sm hover:border-accent/60"
      }`}
    >
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
        {task.agentRun && (
          <span
            className={`inline-flex items-center ${task.agentRun === "running" ? "animate-pulse text-accent" : ""}`}
            title={t(task.agentRun === "running" ? "agentRun.cardRunning" : "agentRun.cardQueued")}
          >
            <Bot className="size-3.5" />
          </span>
        )}
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
