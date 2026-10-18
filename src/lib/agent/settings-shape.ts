// Agent defaults, shared by the server and the run panel. Stored as one JSON
// value in app_settings; anything missing or invalid falls back to the defaults.

import { z } from "zod";
import { LIMIT_MODES, STATUSES, TOKEN_PRESETS, type TokenPreset } from "../types";

export const MIN_TOKEN_LIMIT = 1_000;
export const MAX_TOKEN_LIMIT = 50_000_000;
export const MAX_TIMEOUT_SECONDS = 6 * 60 * 60;

const tokenLimit = z.number().int().min(MIN_TOKEN_LIMIT).max(MAX_TOKEN_LIMIT);

export const agentSettingsSchema = z.object({
  /** OpenClaw agent that works on tasks; null means the Gateway's default agent. */
  agentId: z.string().trim().min(1).max(100).nullable().catch(null),
  model: z.string().trim().min(1).max(200).nullable().catch(null),
  thinking: z.string().trim().min(1).max(40).nullable().catch(null),
  timeoutSeconds: z.number().int().min(60).max(MAX_TIMEOUT_SECONDS).catch(30 * 60),
  /**
   * Token budgets per difficulty. Counted the way OpenClaw counts a session's
   * usage (input + output + cache reads and writes), so agent runs with many
   * tool calls add up fast.
   */
  tokenPresets: z
    .object({ simple: tokenLimit, medium: tokenLimit, hard: tokenLimit })
    .catch({ simple: 250_000, medium: 1_000_000, hard: 4_000_000 }),
  defaultPreset: z.enum(TOKEN_PRESETS).catch("medium"),
  limitMode: z.enum(LIMIT_MODES).catch("hard"),
  /** Runs at the same time; the rest wait in the queue. */
  concurrency: z.number().int().min(1).max(10).catch(1),
  /** Tag that hands a task to the agent automatically. */
  autoTagId: z.number().int().positive().nullable().catch(null),
  /** Where the task goes when the agent finishes or gets stuck. */
  statusOnDone: z.enum(STATUSES).catch("pending"),
  statusOnBlocked: z.enum(STATUSES).catch("pending"),
  /** Standing instructions added to every run. */
  instructions: z.string().max(10_000).catch(""),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = agentSettingsSchema.parse({});

export function parseAgentSettings(raw: unknown): AgentSettings {
  const value = raw && typeof raw === "object" ? raw : {};
  return agentSettingsSchema.parse(value);
}

export function presetLimit(settings: AgentSettings, preset: TokenPreset): number {
  return settings.tokenPresets[preset];
}

