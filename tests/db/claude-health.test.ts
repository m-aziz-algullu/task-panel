// The Claude sign-in check against a real (in-memory PGlite) database and a fake
// OpenClaw Gateway: one tiny real turn decides whether the sign-in still works.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { checkClaude, readClaudeHealth, recordClaudeHealth } from "@/lib/agent/claude-health";
import { saveAgentSettings } from "@/lib/agent/settings";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/agent/settings-shape";
import type { Db } from "@/lib/db";
import { resetDb } from "./helpers";

const expired = "Failed to authenticate: OAuth session expired and could not be refreshed";
let db: Db;

function called(method: string) {
  return gateway.calls.filter((call) => call.method === method);
}

beforeEach(async () => {
  db = await resetDb();
  gateway.calls = [];
  gateway.reply = "OK";
  gateway.handlers = {
    "sessions.create": () => ({ runId: "oc-check", runStarted: true }),
    "agent.wait": () => ({ status: "ok" }),
    "sessions.abort": () => ({}),
    "sessions.delete": () => ({}),
  };
});

describe("checkClaude", () => {
  it("records a working sign-in and cleans up its session", async () => {
    await saveAgentSettings(db, { ...DEFAULT_AGENT_SETTINGS, agentId: "main", model: "anthropic/claude-sonnet-5-5" });
    expect(await checkClaude(db)).toEqual({ outcome: "ok" });

    // Same agent and model as task runs, so it tests the path runs take.
    const [create] = called("sessions.create");
    expect(create.params).toMatchObject({ agentId: "main", model: "anthropic/claude-sonnet-5-5", thinkingLevel: "off" });
    expect(called("sessions.delete")).toMatchObject([
      { params: { key: create.params.key, agentId: "main", deleteTranscript: true } },
    ]);
    expect(called("sessions.abort")).toHaveLength(0);
    expect(await readClaudeHealth(db)).toMatchObject({ ok: true, source: "check", error: null });
  });

  it("finds an OAuth session that can no longer be refreshed", async () => {
    await recordClaudeHealth(db, { ok: true, source: "run" });
    gateway.handlers["agent.wait"] = () => ({ status: "error", error: { message: expired } });
    expect(await checkClaude(db)).toEqual({ outcome: "auth", error: expired });
    expect(await readClaudeHealth(db)).toMatchObject({ ok: false, source: "check", error: expired });
  });

  it("recognises OpenClaw's failed-turn notice as the reply", async () => {
    gateway.reply = `Your request couldn't be completed: ${expired}`;
    expect((await checkClaude(db)).outcome).toBe("auth");
  });

  it("records other failures too, so an earlier success doesn't keep showing", async () => {
    await recordClaudeHealth(db, { ok: true, source: "run" });
    gateway.handlers["sessions.create"] = () => ({ runError: { message: "rate limit reached" } });
    expect(await checkClaude(db)).toEqual({ outcome: "error", error: "rate limit reached" });
    expect(await readClaudeHealth(db)).toMatchObject({ ok: false, source: "check", error: "rate limit reached" });
  });

  it("aborts its turn when the Gateway call fails midway", async () => {
    gateway.handlers["agent.wait"] = () => {
      throw new Error("connection lost");
    };
    expect(await checkClaude(db)).toEqual({ outcome: "error", error: "connection lost" });
    expect(called("sessions.abort")).toMatchObject([{ params: { runId: "oc-check" } }]);
    expect(called("sessions.delete")).toHaveLength(1);
  });

  it("runs one check at a time for concurrent callers", async () => {
    const [a, b] = await Promise.all([checkClaude(db), checkClaude(db)]);
    expect(a).toEqual({ outcome: "ok" });
    expect(b).toBe(a);
    expect(called("sessions.create")).toHaveLength(1);
  });
});
