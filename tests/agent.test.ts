import { describe, expect, it } from "vitest";
import { SESSION_KEY_PREFIX as GATEWAY_PREFIX } from "../docker/openclaw-bootstrap.mjs";
import { claudeAuthFrom, claudeCliModels } from "@/lib/agent/claude-auth";
import { buildRunPrompt, parseRunReport, type PromptInput } from "@/lib/agent/prompt";
import { DEFAULT_AGENT_SETTINGS, parseAgentSettings } from "@/lib/agent/settings-shape";
import { parseSystemComment, systemCommentBody } from "@/lib/agent/system-comments";
import en from "@/i18n/dictionaries/en";
import { AGENT_SESSION_KEY_PREFIX } from "@/lib/types";
import { translate } from "@/i18n/translate";

const base: PromptInput = {
  task: { id: 7, title: "Rakip fiyatlarını araştır", description: "İlk üç rakip yeter.", status: "backlog", day: "2026-10-18" },
  tagNames: ["Araştırma"],
  comments: [{ author: "user", body: "Kaynak linki ekle.", createdAt: "2026-10-18T08:00:00.000Z" }],
  instructions: "Always answer in Turkish.",
  tokenLimit: 250_000,
  limitMode: "hard",
  timeoutSeconds: 1800,
};

describe("buildRunPrompt", () => {
  it("carries the task, its comments, the report format and the limits, but no credentials", () => {
    const prompt = buildRunPrompt(base);
    expect(prompt).toContain("task #7");
    expect(prompt).toContain("Title: Rakip fiyatlarını araştır");
    expect(prompt).toContain("Tags: Araştırma");
    expect(prompt).toContain("İlk üç rakip yeter.");
    expect(prompt).toContain("Kaynak linki ekle.");
    expect(prompt).toContain("Always answer in Turkish.");
    expect(prompt).toContain("`RESULT: done`");
    expect(prompt).toContain("`RESULT: blocked`");
    expect(prompt).not.toMatch(/Bearer|token:|\/api\//i);
    expect(prompt).toContain("250,000 tokens");
    expect(prompt).toContain("about 30 minutes");
    expect(prompt).toContain("Task Panel stops the run");
    expect(prompt).not.toContain("create_goal");
  });

  it("asks for an OpenClaw goal budget under a soft limit", () => {
    const prompt = buildRunPrompt({ ...base, limitMode: "soft" });
    expect(prompt).toContain("`create_goal`");
    expect(prompt).toContain("`token_budget: 250000`");
  });

  it("leaves out empty sections", () => {
    const prompt = buildRunPrompt({ ...base, comments: [], instructions: " ", tagNames: [] });
    expect(prompt).not.toContain("## Earlier comments");
    expect(prompt).not.toContain("## Standing instructions");
    expect(prompt).not.toContain("Tags:");
  });
});

describe("agent settings", () => {
  it("falls back to the defaults for missing or broken values", () => {
    expect(parseAgentSettings(null)).toEqual(DEFAULT_AGENT_SETTINGS);
    const parsed = parseAgentSettings({ concurrency: 99, limitMode: "soft", tokenPresets: { simple: 5 } });
    expect(parsed.concurrency).toBe(DEFAULT_AGENT_SETTINGS.concurrency);
    expect(parsed.limitMode).toBe("soft");
    expect(parsed.tokenPresets).toEqual(DEFAULT_AGENT_SETTINGS.tokenPresets);
  });

  it("orders the token presets from simple to hard", () => {
    const { simple, medium, hard } = DEFAULT_AGENT_SETTINGS.tokenPresets;
    expect(simple).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
  });
});

describe("system comments", () => {
  it("round-trips a message key with its values and renders it per language", () => {
    const body = systemCommentBody("agentRun.systemBudget", { used: 260_000, limit: 250_000 });
    const parsed = parseSystemComment(body);
    expect(parsed).toEqual({ key: "agentRun.systemBudget", vars: { used: 260_000, limit: 250_000 } });
    expect(translate(en, "en-US", parsed!.key, parsed!.vars)).toBe(
      "Token budget spent (260000 / 250000); the run was stopped.",
    );
  });

  it("treats everything else as plain text", () => {
    expect(parseSystemComment("Just a note")).toBeNull();
    expect(parseSystemComment('{"key":"errors.generic"}')).toBeNull();
    expect(parseSystemComment("{not json")).toBeNull();
  });
});

describe("session keys", () => {
  it("use the prefix the Gateway is configured to accept", () => {
    expect(AGENT_SESSION_KEY_PREFIX).toBe(GATEWAY_PREFIX);
  });
});

describe("claudeAuthFrom", () => {
  it("is missing until OpenClaw has a Claude profile", () => {
    expect(claudeAuthFrom(null)).toEqual({ state: "unknown" });
    expect(claudeAuthFrom({ providers: [] })).toEqual({ state: "missing" });
    expect(claudeAuthFrom({ providers: [{ provider: "openai", status: "ok", profiles: [] }] })).toEqual({
      state: "missing",
    });
  });

  it("recognises the subscription sign-in through Claude Code", () => {
    const status = {
      providers: [
        {
          provider: "anthropic",
          status: "ok",
          profiles: [{ type: "oauth", externallyManaged: true, email: "me@example.com" }],
        },
      ],
    };
    expect(claudeAuthFrom(status)).toEqual({ state: "connected", method: "subscription", email: "me@example.com" });
  });

  it("recognises a subscription connected through the Claude Code CLI runtime", () => {
    // What `openclaw models auth login --provider anthropic --method cli` leaves behind:
    // no auth profile, the models marked with the CLI runtime instead.
    const defaults = {
      model: { primary: "anthropic/claude-opus-5-5" },
      models: { "anthropic/claude-opus-5-5": { agentRuntime: { id: "claude-cli" } }, "openai/gpt-6": {} },
    };
    expect(claudeCliModels(defaults)).toEqual(["anthropic/claude-opus-5-5"]);
    expect(claudeAuthFrom({ providers: [] }, defaults)).toEqual({ state: "connected", method: "subscription", email: null });
    expect(claudeAuthFrom(null, defaults)).toEqual({ state: "connected", method: "subscription", email: null });
    expect(claudeAuthFrom({ providers: [] }, { models: { "openai/gpt-6": {} } })).toEqual({ state: "missing" });
  });

  it("tells an API key and an expired sign-in apart", () => {
    expect(
      claudeAuthFrom({ providers: [{ provider: "anthropic", status: "static", profiles: [{ type: "api_key" }] }] }),
    ).toEqual({ state: "connected", method: "api_key", email: null });
    expect(
      claudeAuthFrom({ providers: [{ provider: "anthropic", status: "expired", profiles: [{ type: "oauth" }] }] }),
    ).toEqual({ state: "expired" });
  });
});

describe("parseRunReport", () => {
  it("reads the outcome line and keeps the rest as the report", () => {
    expect(parseRunReport("RESULT: done\n\nFound 3 offers.")).toEqual({ outcome: "done", body: "Found 3 offers." });
    expect(parseRunReport("**RESULT: blocked**\nNeed the login.")).toEqual({ outcome: "blocked", body: "Need the login." });
    expect(parseRunReport("  `RESULT: Done`  \nok")).toEqual({ outcome: "done", body: "ok" });
  });

  it("treats a message without the line as a finished report", () => {
    expect(parseRunReport("Here is what I found.")).toEqual({ outcome: "done", body: "Here is what I found." });
    expect(parseRunReport("The RESULT: done line is not at the start")).toEqual({
      outcome: "done",
      body: "The RESULT: done line is not at the start",
    });
  });

  it("has no report for an empty message and caps long ones", () => {
    expect(parseRunReport(null)).toBeNull();
    expect(parseRunReport("  ")).toBeNull();
    expect(parseRunReport(`RESULT: done\n${"x".repeat(20_000)}`)!.body).toHaveLength(10_000);
  });
});

