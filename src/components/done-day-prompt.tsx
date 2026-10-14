"use client";

import { CalendarCheck, CalendarClock } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { formatDay } from "@/lib/dates";
import type { Task } from "@/lib/types";
import { Modal } from "./modal";

export type DoneResolution = { day?: string; completedDay?: string };

/**
 * Shown when a task planned for another day is dropped into Done: either move it
 * to today, or (for a past day) record the completion on the day it belonged to.
 */
export function DoneDayPrompt({
  task,
  today,
  onResolve,
  onCancel,
}: {
  task: Task;
  today: string;
  onResolve: (resolution: DoneResolution) => void;
  onCancel: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const labels = { today: t("days.today"), tomorrow: t("days.tomorrow"), yesterday: t("days.yesterday") };
  const plannedDay = formatDay(task.day, today, labels, intlLocale);
  const isPast = task.day < today;

  return (
    <Modal title={t("doneDay.title")} onClose={onCancel}>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm">{t("doneDay.body", { title: task.title, day: plannedDay })}</p>
        <div className="flex flex-col gap-2">
          {isPast && (
            <button
              type="button"
              className="btn btn-primary justify-start"
              autoFocus
              onClick={() => onResolve({ completedDay: task.day })}
            >
              <CalendarCheck className="size-4" /> {t("doneDay.recordOnDay", { day: plannedDay })}
            </button>
          )}
          <button
            type="button"
            className={`btn justify-start ${isPast ? "btn-outline" : "btn-primary"}`}
            autoFocus={!isPast}
            onClick={() => onResolve({ day: today, completedDay: today })}
          >
            <CalendarClock className="size-4" /> {t("doneDay.moveToToday")}
          </button>
          <button type="button" className="btn btn-ghost justify-start text-muted" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
