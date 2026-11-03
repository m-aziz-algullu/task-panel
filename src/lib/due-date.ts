// When a task's deadline should catch the eye. Pure, so the card and tests share it.

import { daysUntil } from "./dates";
import type { Status } from "./types";

/** The card lights up this many days before the due date (and stays lit on the day and after). */
export const DUE_SOON_DAYS = 2;

export type DueAlert =
  /** Due within DUE_SOON_DAYS; `daysLeft` is 0 on the due date itself. */
  | { kind: "soon"; daysLeft: number }
  /** The due date has passed. */
  | { kind: "overdue"; daysLate: number };

/** Null when there's nothing to remind about: the task is done or the deadline is still far off. */
export function dueAlert(task: { status: Status; dueDate: string }, today: string): DueAlert | null {
  if (task.status === "done") return null;
  const daysLeft = daysUntil(today, task.dueDate);
  if (daysLeft < 0) return { kind: "overdue", daysLate: -daysLeft };
  if (daysLeft <= DUE_SOON_DAYS) return { kind: "soon", daysLeft };
  return null;
}
