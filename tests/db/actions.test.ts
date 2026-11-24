// Server Actions against a real (in-memory PGlite) database with every migration
// applied. Only the request plumbing (session cookie, refresh) and the OpenClaw
// Gateway are stubbed.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
  process.env.APP_TIMEZONE = "Europe/Istanbul";
  return { agent: false, signedIn: true };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => {
    if (!state.signedIn) throw new Error("NEXT_REDIRECT /login");
    return { id: 1, name: "Aziz", email: "a@example.com", role: "admin" };
  }),
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/openclaw/connection", () => ({
  agentEnabled: () => state.agent,
  gatewayConnection: () => null,
}));
vi.mock("@/lib/agent/worker", () => ({ pokeAgentWorker: vi.fn(), abortSession: vi.fn() }));

import { refresh } from "next/cache";
import * as actions from "@/app/actions";
import { abortSession } from "@/lib/agent/worker";
import { saveAgentSettings } from "@/lib/agent/settings";
import { parseAgentSettings } from "@/lib/agent/settings-shape";
import { getClock } from "@/lib/data";
import { schema, type Db } from "@/lib/db";
import type { TaskInput } from "@/lib/types";
import { doc, resetDb } from "./helpers";

const { tasks, taskComments, agentRuns, routines } = schema;

const runInput = {
  agentId: null,
  model: null,
  thinking: null,
  timeoutSeconds: 600,
  tokenLimit: 100_000,
  limitMode: "hard" as const,
};

let db: Db;

function taskInput(overrides: Partial<TaskInput> = {}): TaskInput {
  const today = getClock().today;
  return {
    title: "Write the report",
    descriptionDoc: doc("details"),
    status: "backlog",
    storyPoints: 3,
    day: today,
    dueDate: today,
    tagIds: [],
    ...overrides,
  };
}

async function ok<T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.data;
}

beforeEach(async () => {
  db = await resetDb();
  state.agent = false;
  state.signedIn = true;
  vi.clearAllMocks();
});

describe("session", () => {
  it("refuses every action without a session, before touching the database", async () => {
    state.signedIn = false;
    await expect(actions.createTask(taskInput())).rejects.toThrow("NEXT_REDIRECT");
    await expect(actions.deleteTag(1)).rejects.toThrow("NEXT_REDIRECT");
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("creates a task with its tags on top of its column and refreshes the board", async () => {
    const tag = await ok(actions.createTag({ name: "Work", color: "#2563EB" }));
    expect(tag.color).toBe("#2563eb");
    const first = await ok(actions.createTask(taskInput({ title: "First" })));
    const second = await ok(actions.createTask(taskInput({ title: "Second", tagIds: [tag.id, tag.id, 999] })));

    expect(second.tagIds).toEqual([tag.id]);
    expect(second.description).toBe("details");
    const rows = await db.select().from(tasks);
    const position = (id: number) => rows.find((row) => row.id === id)!.position;
    expect(position(second.id)).toBeLessThan(position(first.id));
    expect(refresh).toHaveBeenCalled();
  });

  it("rejects invalid input with a translatable error key", async () => {
    expect(await actions.createTask(taskInput({ title: "  " }))).toEqual({ ok: false, error: "errors.titleRequired" });
    expect(await actions.createTask(taskInput({ dueDate: "tomorrow" }))).toEqual({
      ok: false,
      error: "errors.dueDateInvalid",
    });
    expect(await actions.createTask(taskInput({ descriptionDoc: { type: "nope" } as never }))).toEqual({
      ok: false,
      error: "errors.descriptionInvalid",
    });
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("stamps completed_at on entering Done and clears it on leaving", async () => {
    const task = await ok(actions.createTask(taskInput()));
    await ok(actions.updateTask(task.id, taskInput({ status: "done" })));
    let [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.completedAt).toBeInstanceOf(Date);

    await ok(actions.updateTask(task.id, taskInput({ status: "in_progress" })));
    [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.completedAt).toBeNull();
    expect(await actions.updateTask(9999, taskInput())).toEqual({ ok: false, error: "errors.taskNotFound" });
  });

  it("moves a task and stores the column's order as given", async () => {
    const a = await ok(actions.createTask(taskInput({ title: "A", status: "in_progress" })));
    const b = await ok(actions.createTask(taskInput({ title: "B" })));
    await ok(actions.moveTask(b.id, "in_progress", [a.id, b.id]));

    const rows = await db.select().from(tasks).where(eq(tasks.status, "in_progress"));
    expect(Object.fromEntries(rows.map((row) => [row.title, row.position]))).toEqual({ A: 0, B: 1 });
  });

  it("deletes a task together with its comments", async () => {
    const task = await ok(actions.createTask(taskInput()));
    await ok(actions.addComment(task.id, "a note"));
    await ok(actions.deleteTask(task.id));
    expect(await db.select().from(taskComments)).toHaveLength(0);
    expect(await actions.addComment(task.id, "late")).toEqual({ ok: false, error: "errors.taskNotFound" });
  });
});

describe("tags", () => {
  it("keeps tag names unique regardless of case", async () => {
    const tag = await ok(actions.createTag({ name: "Work", color: "#2563eb" }));
    expect(await actions.createTag({ name: "work", color: "#000000" })).toEqual({ ok: false, error: "errors.tagExists" });
    await ok(actions.updateTag(tag.id, { name: "WORK", color: "#111111" }));
    expect(await actions.updateTag(999, { name: "Other", color: "#111111" })).toEqual({
      ok: false,
      error: "errors.tagNotFound",
    });
  });
});

describe("agent", () => {
  async function agentTag() {
    const tag = await ok(actions.createTag({ name: "agent", color: "#7c3aed" }));
    await saveAgentSettings(db, { ...parseAgentSettings({}), autoTagId: tag.id });
    return tag;
  }

  it("queues a run when the agent tag is added and cancels it when removed", async () => {
    state.agent = true;
    const tag = await agentTag();
    const task = await ok(actions.createTask(taskInput({ tagIds: [tag.id] })));
    let [run] = await db.select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(run).toMatchObject({ status: "queued", trigger: "tag" });

    await ok(actions.updateTask(task.id, taskInput({ tagIds: [] })));
    [run] = await db.select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(run.status).toBe("aborted");
  });

  it("does nothing with the agent tag while the agent is off", async () => {
    const tag = await agentTag();
    await ok(actions.createTask(taskInput({ tagIds: [tag.id] })));
    expect(await db.select().from(agentRuns)).toHaveLength(0);
  });

  it("allows one active run per task and stops it on request", async () => {
    const task = await ok(actions.createTask(taskInput()));
    expect(await actions.startAgentRun(task.id, runInput)).toEqual({ ok: false, error: "errors.agentUnavailable" });

    state.agent = true;
    const run = await ok(actions.startAgentRun(task.id, runInput));
    expect(run).toMatchObject({ status: "queued", trigger: "manual" });
    expect(await actions.startAgentRun(task.id, runInput)).toEqual({ ok: false, error: "errors.agentRunActive" });

    await ok(actions.stopAgentRun(task.id));
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    expect(row.status).toBe("aborted");
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, task.id));
    expect(comments.map((comment) => comment.author)).toEqual(["system"]);
  });

  it("stops the OpenClaw session of a running run when its task is deleted", async () => {
    state.agent = true;
    const task = await ok(actions.createTask(taskInput()));
    const run = await ok(actions.startAgentRun(task.id, runInput));
    await db.update(agentRuns).set({ status: "running", openclawRunId: "oc-1" }).where(eq(agentRuns.id, run.id));

    await ok(actions.deleteTask(task.id));
    expect(await db.select().from(agentRuns)).toHaveLength(0);
    expect(abortSession).toHaveBeenCalledWith(expect.objectContaining({ id: run.id, openclawRunId: "oc-1" }));
  });

  it("has no session to stop when a deleted task's run was only queued", async () => {
    state.agent = true;
    const task = await ok(actions.createTask(taskInput()));
    await ok(actions.startAgentRun(task.id, runInput));
    await ok(actions.deleteTask(task.id));
    expect(abortSession).not.toHaveBeenCalled();
  });

  it("continues the agent's conversation when the user comments after a run", async () => {
    state.agent = true;
    const task = await ok(actions.createTask(taskInput()));
    const first = await ok(actions.startAgentRun(task.id, runInput));
    await db.update(agentRuns).set({ status: "done", finishedAt: new Date() }).where(eq(agentRuns.id, first.id));

    await ok(actions.addComment(task.id, "one more thing"));
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(runs).toHaveLength(2);
    const followUp = runs.find((run) => run.id !== first.id)!;
    const [original] = runs.filter((run) => run.id === first.id);
    expect(followUp).toMatchObject({ status: "queued", continuesRunId: first.id, sessionKey: original.sessionKey });
  });
});

describe("routines", () => {
  const daily = { kind: "daily" as const, time: "09:00" };

  it("computes the first due time only for a scheduled routine", async () => {
    const plain = await ok(actions.createRoutine({ title: "Plain", body: "", schedule: null, handToAgent: false }));
    const scheduled = await ok(actions.createRoutine({ title: "Daily", body: "", schedule: daily, handToAgent: false }));
    expect(plain.nextRunAt).toBeNull();
    expect(new Date(scheduled.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps the due time when only the notes change, and recomputes it for a new schedule", async () => {
    const routine = await ok(actions.createRoutine({ title: "Daily", body: "", schedule: daily, handToAgent: false }));
    const pinned = new Date("2030-01-01T06:00:00Z");
    await db.update(routines).set({ nextRunAt: pinned }).where(eq(routines.id, routine.id));

    const edited = await ok(
      actions.updateRoutine(routine.id, { title: "Daily", body: "new notes", schedule: daily, handToAgent: false }),
    );
    expect(edited.nextRunAt).toBe(pinned.toISOString());

    const moved = await ok(
      actions.updateRoutine(routine.id, {
        title: "Daily",
        body: "new notes",
        schedule: { kind: "daily", time: "18:30" },
        handToAgent: false,
      }),
    );
    expect(moved.nextRunAt).not.toBe(pinned.toISOString());
  });

  it("runs a routine now without moving its schedule", async () => {
    const routine = await ok(
      actions.createRoutine({ title: "Water plants", body: "both rooms", schedule: daily, handToAgent: false }),
    );
    const { taskId } = await ok(actions.runRoutineNow(routine.id));
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toMatchObject({ title: "Water plants", description: "both rooms", status: "backlog" });
    const [row] = await db.select().from(routines).where(eq(routines.id, routine.id));
    expect(row.nextRunAt?.toISOString()).toBe(routine.nextRunAt);
    expect(row.lastRunAt).toBeInstanceOf(Date);
    expect(await actions.runRoutineNow(999)).toEqual({ ok: false, error: "errors.routineNotFound" });
  });
});
