// The routine scheduler's firing step on a real database: one task per due
// routine, next_run_at moved past now, missed occurrences not made up.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
  process.env.APP_TIMEZONE = "Europe/Istanbul";
  return { agent: false };
});
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/openclaw/connection", () => ({ agentEnabled: () => state.agent, gatewayConnection: () => null }));
vi.mock("@/lib/agent/worker", () => ({ pokeAgentWorker: vi.fn(), abortSession: vi.fn() }));

import { getClock } from "@/lib/data";
import { schema, type Db } from "@/lib/db";
import { fireDueRoutine } from "@/lib/routine-scheduler";
import { resetDb } from "./helpers";

const { routines, tasks, agentRuns } = schema;
const HOUR = 60 * 60 * 1000;

let db: Db;

async function routine(values: Partial<typeof routines.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(routines)
    .values({
      title: "Check backups",
      body: "look at the logs",
      schedule: { kind: "daily", time: "09:00" },
      handToAgent: false,
      nextRunAt: new Date(Date.now() - HOUR),
      ...values,
    })
    .returning({ id: routines.id });
  return row.id;
}

beforeEach(async () => {
  db = await resetDb();
  state.agent = false;
});

describe("fireDueRoutine", () => {
  it("returns null when nothing is due", async () => {
    await routine({ nextRunAt: new Date(Date.now() + HOUR) });
    await routine({ schedule: null, nextRunAt: null });
    expect(await fireDueRoutine(db)).toBeNull();
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("creates today's task and moves the routine to its next occurrence", async () => {
    const id = await routine();
    const result = await fireDueRoutine(db);
    expect(result).toMatchObject({ routineId: id, queued: false });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, result!.taskId!));
    const today = getClock().today;
    expect(task).toMatchObject({ title: "Check backups", description: "look at the logs", status: "backlog", day: today, dueDate: today });
    const [row] = await db.select().from(routines).where(eq(routines.id, id));
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastRunAt).toBeInstanceOf(Date);
    expect(await fireDueRoutine(db)).toBeNull();
  });

  it("does not make up occurrences missed while the server was down", async () => {
    await routine({ nextRunAt: new Date(Date.now() - 10 * 24 * HOUR) });
    expect(await fireDueRoutine(db)).not.toBeNull();
    expect(await fireDueRoutine(db)).toBeNull();
    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it("fires the most overdue routine first", async () => {
    const later = await routine({ nextRunAt: new Date(Date.now() - HOUR) });
    const earlier = await routine({ nextRunAt: new Date(Date.now() - 2 * HOUR) });
    expect((await fireDueRoutine(db))?.routineId).toBe(earlier);
    expect((await fireDueRoutine(db))?.routineId).toBe(later);
  });

  it("queues a routine run when the routine hands its task to the agent", async () => {
    await routine({ handToAgent: true });
    state.agent = true;
    const result = await fireDueRoutine(db);
    expect(result?.queued).toBe(true);
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.taskId, result!.taskId!));
    expect(runs).toMatchObject([{ status: "queued", trigger: "routine" }]);
  });

  it("creates the task but no run when the agent is off", async () => {
    await routine({ handToAgent: true });
    const result = await fireDueRoutine(db);
    expect(result).toMatchObject({ queued: false });
    expect(result?.taskId).not.toBeNull();
    expect(await db.select().from(agentRuns)).toHaveLength(0);
  });
});
