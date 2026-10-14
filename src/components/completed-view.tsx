"use client";

import { CheckCheck, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";
import { addDays, formatLongDay } from "@/lib/dates";
import type { Clock, Tag, Task } from "@/lib/types";
import { DateRangePicker } from "./date-range-picker";
import { EMPTY_FILTERS, FilterBar, matchesFilters, type Filters } from "./filters";
import { CARD_WIDTH } from "./card-size";
import { TaskCard } from "./task-card";
import { TaskDialog } from "./task-dialog";
import { useDayRollover } from "./use-day-rollover";

function dayBadge(day: string, today: string, t: Translate): string | null {
  if (day === today) return t("days.today");
  if (day === addDays(today, -1)) return t("days.yesterday");
  return null;
}

export function CompletedView({ tasks, tags, clock }: { tasks: Task[]; tags: Tag[]; clock: Clock }) {
  const { t, intlLocale } = useI18n();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useDayRollover(clock.nextDayAt);

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  // With no day or range picked, show the last 7 days (today included).
  const isDefaultRange = !from && !to;
  const rangeFrom = isDefaultRange ? addDays(clock.today, -6) : from;
  const rangeTo = to;

  const rangeTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.completedDay != null &&
          (!rangeFrom || task.completedDay >= rangeFrom) &&
          (!rangeTo || task.completedDay <= rangeTo),
      ),
    [tasks, rangeFrom, rangeTo],
  );

  // Tasks arrive newest first, so groups come out newest day first.
  const groups = useMemo(() => {
    const byDay = new Map<string, Task[]>();
    for (const task of rangeTasks) {
      if (!task.completedDay || !matchesFilters(task, filters, intlLocale)) continue;
      byDay.set(task.completedDay, [...(byDay.get(task.completedDay) ?? []), task]);
    }
    return [...byDay.entries()];
  }, [rangeTasks, filters, intlLocale]);

  const openTask = openId == null ? undefined : tasks.find((task) => task.id === openId);
  const totalPoints = rangeTasks.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="text-lg font-semibold">{t("completed.title")}</h1>
          <p className="text-xs text-muted">
            {t("completed.summary", {
              tasks: t("completed.tasks", { count: rangeTasks.length }),
              points: totalPoints,
            })}
          </p>
        </div>
        <FilterBar tags={tags} filters={filters} onChange={setFilters} />
        <div className="ml-auto">
          <DateRangePicker
            value={{ from, to }}
            onChange={(range) => {
              setFrom(range.from);
              setTo(range.to);
            }}
            today={clock.today}
            placeholder={t("completed.last7")}
          />
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-20 text-center text-muted">
          <CheckCheck className="size-8" />
          <p className="text-sm">{t("completed.empty")}</p>
        </div>
      )}
      {tasks.length > 0 && groups.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          {rangeTasks.length === 0 ? t("completed.noneInRange") : t("completed.noMatch")}
        </p>
      )}

      {groups.map(([day, dayTasks]) => {
        const badge = dayBadge(day, clock.today, t);
        const points = dayTasks.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);
        const isCollapsed = collapsed.has(day);
        const toggle = () =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(day)) next.add(day);
            return next;
          });
        return (
          <section key={day} className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
              <button
                type="button"
                className="icon-btn size-7"
                aria-expanded={!isCollapsed}
                title={isCollapsed ? t("completed.expand") : t("completed.collapse")}
                onClick={toggle}
              >
                {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </button>
              <h2 className="text-base font-semibold">{formatLongDay(day, intlLocale)}</h2>
              {badge && (
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">{badge}</span>
              )}
              <span className="text-sm text-muted">
                {t("completed.tasks", { count: dayTasks.length })}
                {points > 0 && ` · ${points} SP`}
              </span>
            </header>
            {!isCollapsed && (
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH})`,
                }}
              >
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="cursor-pointer rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => setOpenId(task.id)}
                  >
                    <TaskCard task={task} tagsById={tagsById} today={clock.today} />
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {openTask && (
        <TaskDialog key={openTask.id} task={openTask} tags={tags} clock={clock} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
