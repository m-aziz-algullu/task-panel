import "server-only";

import { min, eq } from "drizzle-orm";
import { getClock } from "./data";
import { addDays, dayKey, startOfDay } from "./dates";
import { schema, type Db } from "./db";
import type { Status } from "./types";

const { tasks } = schema;

/** Position that puts a task on top of `status`'s column. */
export async function topPosition(db: Db, status: Status): Promise<number> {
  const [row] = await db
    .select({ value: min(tasks.position) })
    .from(tasks)
    .where(eq(tasks.status, status));
  return row?.value == null ? 0 : row.value - 1;
}

/**
 * completed_at follows the status: stamped on entering Done, cleared on leaving it.
 * `completedDay` records the completion on an earlier day (e.g. yesterday's leftovers
 * finished this morning) by stamping the last moment of that day.
 */
export function completedAtFor(
  next: Status,
  previous: { status: string; completedAt: Date | null } | null,
  completedDay?: string,
) {
  if (next !== "done") return null;
  const kept = previous?.status === "done" ? previous.completedAt : null;
  if (completedDay) {
    const { today, timeZone } = getClock();
    if (kept && dayKey(kept, timeZone) === completedDay) return kept;
    if (completedDay === today) return new Date();
    return new Date(startOfDay(addDays(completedDay, 1), timeZone).getTime() - 1);
  }
  return kept ?? new Date();
}

/** Moves a task to the top of another column, outside the board's drag and drop (e.g. when the agent finishes). */
export async function moveTaskTo(db: Db, taskId: number, status: Status): Promise<void> {
  const [current] = await db
    .select({ status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!current || current.status === status) return;
  await db
    .update(tasks)
    .set({
      status,
      position: await topPosition(db, status),
      completedAt: completedAtFor(status, current),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
}
