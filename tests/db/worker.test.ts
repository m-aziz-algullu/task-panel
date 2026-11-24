// The agent worker against a real (in-memory PGlite) database and a fake OpenClaw
// Gateway: each test scripts the Gateway's answers and drives one run to its end.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (params: Record<string, unknown>) => unknown;

const gateway = vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
  return {
    handlers: {} as Record<string, Handler>,
    calls: [] as { method: string; params: Record<string, unknown> }[],
    reply: null as string | null,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/push/dispatcher", () => ({ pokePushDispatcher: vi.fn() }));
vi.mock("@/lib/openclaw/connection", () => ({
  agentEnabled: () => true,
  gatewayConnection: () => ({ url: "ws://127.0.0.1:1", token: "test" }),
}));
vi.mock("@/lib/openclaw/client", () => {
  class GatewayUnavailableError extends Error {}
  return {
    GatewayUnavailableError,
    gatewayRequest: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      gateway.calls.push({ method, params });
      const handler = gateway.handlers[method];
      if (!handler) throw new Error(`unexpected Gateway call ${method}`);
      return handler(params);
    }),
  };
});
vi.mock("@/lib/agent/reply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/reply")>()),
  turnReply: vi.fn(async () => gateway.reply),
}));

import { enqueueRun, finalizeRun, runById } from "@/lib/agent/runs";
import { AgentWorker } from "@/lib/agent/worker";
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
let worker: AgentWorker;

async function task(status = "backlog"): Promise<number> {
  const [row] = await db
    .insert(tasks)
    .values({ title: "Find offers", status, day: "2026-11-24", dueDate: "2026-11-24", position: 0 })
    .returning({ id: tasks.id });
  return row.id;
}

async function taskStatus(taskId: number): Promise<string | undefined> {
  const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId));
  return row?.status;
}

/** Runs the worker until it has nothing left in flight. */
async function work(): Promise<void> {
  worker.poke();
  await worker.idle();
}

function called(method: string) {
  return gateway.calls.filter((call) => call.method === method);
}

beforeEach(async () => {
  db = await resetDb();
  worker = new AgentWorker();
  gateway.calls = [];
  gateway.reply = "RESULT: done\nFound 3 offers.";
  gateway.handlers = {
    "sessions.create": () => ({ runId: "oc-1", runStarted: true }),
    "sessions.usage": () => ({ totals: { totalTokens: 1_000 } }),
    "agent.wait": () => ({ status: "ok" }),
    "sessions.abort": () => ({}),
  };
});

afterEach(async () => {
  await worker.idle();
});

describe("agent worker", () => {
  it("starts a run, posts the agent's report and moves the task on", async () => {
    const taskId = await task();
    const run = (await enqueueRun(db, taskId, input, "manual"))!;
    await work();

    expect(await runById(db, run.id)).toMatchObject({ status: "done", openclawRunId: "oc-1", tokensUsed: 1_000 });
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
    expect(comments).toMatchObject([{ author: "agent", body: "Found 3 offers.", runId: run.id }]);
    expect(await taskStatus(taskId)).toBe("pending");
  });

  it("aborts the OpenClaw turn when the run was stopped while it was starting", async () => {
    const taskId = await task();
    const run = (await enqueueRun(db, taskId, input, "manual"))!;
    gateway.handlers["sessions.create"] = async () => {
      // The user presses Stop before the Gateway has answered.
      await finalizeRun(db, run, { status: "aborted" });
      return { runId: "oc-1", runStarted: true };
    };
    await work();

    expect(called("sessions.abort")).toMatchObject([{ params: { runId: "oc-1" } }]);
    expect(called("agent.wait")).toHaveLength(0);
    const row = await runById(db, run.id);
    expect(row).toMatchObject({ status: "aborted", openclawRunId: null });
    // The task stays where the user left it.
    expect(await taskStatus(taskId)).toBe("backlog");
  });

  it("aborts the OpenClaw session when the task is deleted while the run works", async () => {
    const taskId = await task();
    await enqueueRun(db, taskId, input, "manual");
    let waits = 0;
    gateway.handlers["agent.wait"] = async () => {
      if (++waits === 1) await db.delete(tasks).where(eq(tasks.id, taskId));
      return { status: "timeout" };
    };
    await work();

    expect(waits).toBe(1);
    expect(called("sessions.abort")).toMatchObject([{ params: { runId: "oc-1" } }]);
  });

  it("counts a run without a RESULT line as blocked", async () => {
    const taskId = await task();
    const run = (await enqueueRun(db, taskId, input, "manual"))!;
    gateway.reply = "Here is what I found so far.";
    await work();

    expect(await runById(db, run.id)).toMatchObject({ status: "blocked", error: "report without a RESULT line" });
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
    expect(comments).toMatchObject([{ author: "agent", body: "Here is what I found so far." }]);
  });

  describe("follow-ups", () => {
    async function finishedRun(taskId: number) {
      const first = (await enqueueRun(db, taskId, input, "manual"))!;
      const [row] = await db
        .update(schema.agentRuns)
        .set({ status: "blocked", startedAt: new Date(Date.now() - 60_000), finishedAt: new Date() })
        .where(eq(schema.agentRuns.id, first.id))
        .returning();
      await db.insert(taskComments).values({ taskId, author: "user", body: "Try the other shop too." });
      return row;
    }

    it("continues the session and charges only the tokens added since it started", async () => {
      const taskId = await task("pending");
      const previous = await finishedRun(taskId);
      const run = (await enqueueRun(db, taskId, input, "comment", previous))!;
      let total = 90_000;
      gateway.handlers["sessions.describe"] = () => ({ session: { sessionId: "s-1", totalTokens: 20_000 } });
      gateway.handlers["sessions.patch"] = () => ({});
      gateway.handlers["sessions.send"] = () => {
        total += 5_000;
        return { runId: "oc-2", runStarted: true };
      };
      gateway.handlers["sessions.usage"] = () => ({ totals: { totalTokens: total } });
      await work();

      expect(called("sessions.create")).toHaveLength(0);
      expect(String(called("sessions.send")[0].params.message)).toContain("Try the other shop too.");
      expect(await runById(db, run.id)).toMatchObject({
        status: "done",
        sessionKey: previous.sessionKey,
        usageBaseline: 90_000,
        tokensUsed: 5_000,
      });
    });

    it("starts a new session instead of charging the whole conversation when usage can't be read", async () => {
      const taskId = await task("pending");
      const previous = await finishedRun(taskId);
      const run = (await enqueueRun(db, taskId, input, "comment", previous))!;
      gateway.handlers["sessions.describe"] = () => ({ session: { sessionId: "s-1", totalTokens: 20_000 } });
      let created = false;
      gateway.handlers["sessions.usage"] = () => {
        // The old session's usage is unreadable; the new one counts from zero.
        if (!created) throw new Error("usage unavailable");
        return { totals: { totalTokens: 3_000 } };
      };
      gateway.handlers["sessions.create"] = () => {
        created = true;
        return { runId: "oc-2", runStarted: true };
      };
      await work();

      expect(called("sessions.send")).toHaveLength(0);
      const row = await runById(db, run.id);
      expect(row).toMatchObject({ status: "done", continuesRunId: null, usageBaseline: 0, tokensUsed: 3_000 });
      expect(row!.sessionKey).not.toBe(previous.sessionKey);
      // The new session sees the whole task, the user's comment included.
      expect(String(called("sessions.create")[0].params.message)).toContain("Try the other shop too.");
    });
  });
});
