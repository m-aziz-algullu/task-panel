import "server-only";

import { eq, sql } from "drizzle-orm";
import { defaultRunInput } from "./agent/auto";
import { enqueueRun } from "./agent/runs";
import { getAgentSettings } from "./agent/settings";
import { pokeAgentWorker } from "./agent/worker";
import { appTimeZone, getClock } from "./data";
import { getDb, schema, type Db } from "./db";
import { agentEnabled } from "./openclaw/connection";
import { normalizeDocument, plainTextToDocument } from "./rich-text/document";
import { nextRunAt, parseSchedule } from "./routine-schedule";
import { topPosition } from "./task-status";

const { routines, tasks } = schema;

/** The longest the scheduler sleeps, so a routine saved by another instance is still picked up in time. */
const MAX_SLEEP_MS = 60_000;
/** Routines one tick fires at most, so a backlog can't hold the loop forever. */
const MAX_FIRINGS_PER_TICK = 50;

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

/**
 * Fires the most overdue routine, if any: creates its task, queues the agent run
 * when asked, and moves `next_run_at` past now. Locking the row makes this safe
 * with several app instances; the task and the new due time commit together, so
 * a crash can't create a task twice. Occurrences missed while the server was down
 * are not made up: one task, then the next future occurrence.
 */
export async function fireDueRoutine(
  db: Db,
): Promise<{ routineId: number; taskId: number | null; queued: boolean } | null> {
  return db.transaction(async (tx) => {
    const due = rowsOf<{ id: number }>(
      await tx.execute(sql`
        SELECT id FROM routines
        WHERE next_run_at <= now()
        ORDER BY next_run_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`),
    )[0];
    if (!due) return null;
    const [routine] = await tx.select().from(routines).where(eq(routines.id, due.id));
    const now = new Date();
    const schedule = parseSchedule(routine.schedule);
    // Never before the occurrence being fired, even if this clock trails the database's.
    const after = routine.nextRunAt && routine.nextRunAt > now ? routine.nextRunAt : now;
    const next = schedule ? nextRunAt(schedule, after, appTimeZone()) : null;

    try {
      // A savepoint: if this routine can't be fired, it still moves on and doesn't block the others.
      const fired = await tx.transaction((inner) => createRoutineTask(inner, routine, now));
      await tx.update(routines).set({ nextRunAt: next, lastRunAt: now }).where(eq(routines.id, routine.id));
      return { routineId: routine.id, ...fired };
    } catch (error) {
      console.error(`[routines] Could not create a task for routine ${routine.id}:`, error);
      await tx.update(routines).set({ nextRunAt: next }).where(eq(routines.id, routine.id));
      return { routineId: routine.id, taskId: null, queued: false };
    }
  });
}

async function createRoutineTask(
  db: Db,
  routine: typeof routines.$inferSelect,
  now: Date,
): Promise<{ taskId: number; queued: boolean }> {
  const description = normalizeDocument(plainTextToDocument(routine.body));
  const today = getClock(now).today;
  const [task] = await db
    .insert(tasks)
    .values({
      title: routine.title,
      description: description.text,
      descriptionDoc: description.doc,
      status: "backlog",
      day: today,
      // A routine's task is for its own day; nothing gives it a later deadline.
      dueDate: today,
      position: await topPosition(db, "backlog"),
    })
    .returning({ id: tasks.id });

  let queued = false;
  if (routine.handToAgent && agentEnabled()) {
    const settings = await getAgentSettings(db);
    queued = (await enqueueRun(db, task.id, defaultRunInput(settings), "routine")) != null;
  }
  return { taskId: task.id, queued };
}

/** "Run now": the routine's task (and agent run), leaving its schedule alone. Null if there's no such routine. */
export async function createTaskFromRoutine(db: Db, routineId: number): Promise<{ taskId: number; queued: boolean } | null> {
  return db.transaction(async (tx) => {
    const [routine] = await tx.select().from(routines).where(eq(routines.id, routineId)).for("update");
    if (!routine) return null;
    const now = new Date();
    const fired = await createRoutineTask(tx, routine, now);
    await tx.update(routines).set({ lastRunAt: now }).where(eq(routines.id, routine.id));
    return fired;
  });
}

/** Milliseconds until the soonest scheduled routine is due, by the database clock; null if none is. */
async function msUntilNextDue(db: Db): Promise<number | null> {
  const [row] = rowsOf<{ ms: number | string | null }>(
    await db.execute(sql`SELECT extract(epoch FROM min(next_run_at) - now()) * 1000 AS ms FROM routines`),
  );
  return row?.ms == null ? null : Number(row.ms);
}

class RoutineScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;

  start() {
    if (!this.timer && !this.running) this.wake(0);
  }

  /** Re-checks right away, e.g. after a routine's schedule changed. */
  poke() {
    if (this.running) this.again = true;
    else this.wake(0);
  }

  private wake(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick() {
    this.timer = undefined;
    this.running = true;
    let delay = MAX_SLEEP_MS;
    try {
      const db = await getDb();
      let queued = false;
      for (let fired = 0; fired < MAX_FIRINGS_PER_TICK; fired++) {
        const result = await fireDueRoutine(db);
        if (!result) break;
        queued ||= result.queued;
        if (result.taskId != null) {
          const run = result.queued ? " and queued an agent run" : "";
          console.log(`[routines] Routine ${result.routineId} created task ${result.taskId}${run}.`);
        }
      }
      if (queued) pokeAgentWorker();
      const until = await msUntilNextDue(db);
      // A little past the due time, so the database agrees it has come.
      if (until != null) delay = Math.min(MAX_SLEEP_MS, Math.max(0, until) + 250);
    } catch (error) {
      console.error("[routines] Scheduler tick failed:", error);
    } finally {
      this.running = false;
      const again = this.again;
      this.again = false;
      this.wake(again ? 0 : delay);
    }
  }
}

const globalForScheduler = globalThis as unknown as { taskPanelRoutineScheduler?: RoutineScheduler };

function scheduler(): RoutineScheduler {
  globalForScheduler.taskPanelRoutineScheduler ??= new RoutineScheduler();
  return globalForScheduler.taskPanelRoutineScheduler;
}

/** Starts the loop that creates tasks from scheduled routines; runs with or without the agent. */
export function startRoutineScheduler(): void {
  scheduler().start();
}

export function pokeRoutineScheduler(): void {
  scheduler().poke();
}
