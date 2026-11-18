// The agent_runs queue (enqueue / claim / requeue / finalize) on a real database.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
});
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

import {
  activeRunStatuses,
  claimNextRun,
  enqueueRun,
  finalizeRun,
  requeueRun,
  runById,
} from "@/lib/agent/runs";
import { schema, type Db } from "@/lib/db";
import { resetDb } from "./helpers";

const { tasks, taskComments } = schema;

const input = {
  agentId: null,
  model: null,
  thinking: null,
  timeoutSeconds: 600,
  tokenLimit: 100_000,
  limitMode: "hard" as const,
};

let db: Db;

async function task(title = "Task", status = "backlog"): Promise<number> {
  const [row] = await db
    .insert(tasks)
    .values({ title, status, day: "2026-11-18", dueDate: "2026-11-18", position: 0 })
    .returning({ id: tasks.id });
  return row.id;
}

beforeEach(async () => {
  db = await resetDb();
});

describe("agent run queue", () => {
  it("keeps one active run per task", async () => {
    const taskId = await task();
    expect(await enqueueRun(db, taskId, input, "manual")).not.toBeNull();
    expect(await enqueueRun(db, taskId, input, "tag")).toBeNull();
    expect(await activeRunStatuses(db, [taskId])).toEqual(new Map([[taskId, "queued"]]));
  });

  it("claims queued runs oldest first and marks them running", async () => {
    const first = (await enqueueRun(db, await task("A"), input, "manual"))!;
    const second = (await enqueueRun(db, await task("B"), input, "manual"))!;

    const claimed = await claimNextRun(db);
    expect(claimed).toMatchObject({ id: first.id, status: "running" });
    expect(claimed!.startedAt).toBeInstanceOf(Date);
    expect((await claimNextRun(db))?.id).toBe(second.id);
    expect(await claimNextRun(db)).toBeNull();
  });

  it("requeues a new run with a fresh session but keeps a follow-up's conversation", async () => {
    const taskId = await task();
    const run = (await enqueueRun(db, taskId, input, "manual"))!;
    const claimed = (await claimNextRun(db))!;
    await requeueRun(db, claimed);
    const requeued = (await runById(db, run.id))!;
    expect(requeued).toMatchObject({ status: "queued", startedAt: null });
    expect(requeued.sessionKey).not.toBe(claimed.sessionKey);

    await finalizeRun(db, requeued, { status: "done" });
    const followUp = (await enqueueRun(db, taskId, input, "comment", requeued))!;
    const claimedFollowUp = (await claimNextRun(db))!;
    await requeueRun(db, claimedFollowUp);
    expect((await runById(db, followUp.id))!.sessionKey).toBe(requeued.sessionKey);
  });

  it("finalizes a run only once, writing its comment and moving the task", async () => {
    const taskId = await task();
    const run = (await enqueueRun(db, taskId, input, "manual"))!;
    await claimNextRun(db);

    const report = { status: "done" as const, comment: { author: "agent" as const, body: "Finished." }, moveTo: "pending" as const };
    expect(await finalizeRun(db, run, report)).toBe(true);
    // A late stop or timeout loses the race and changes nothing.
    expect(await finalizeRun(db, run, { status: "aborted", moveTo: "backlog" })).toBe(false);

    expect((await runById(db, run.id))!.status).toBe("done");
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row.status).toBe("pending");
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
    expect(comments).toMatchObject([{ author: "agent", body: "Finished.", runId: run.id }]);
  });
});
