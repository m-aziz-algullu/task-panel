// OpenClaw's view of Claude access, reduced to what the UI shows. Shared by the
// server and the agent page; Task Panel never sees Claude credentials.

import type { GatewayStatus } from "../openclaw/client";

/** How OpenClaw reaches Claude: the user's own subscription through Claude Code, or an API key. */
export type ClaudeAuth =
  | { state: "connected"; method: "subscription" | "api_key"; email: string | null }
  | { state: "expired" | "missing" | "unknown" };

export type ClaudeStatus = {
  gateway: GatewayStatus;
  /** Claude Code's CLI was found next to the Gateway (it lists Claude CLI models); null if unknown. */
  cliFound: boolean | null;
  auth: ClaudeAuth;
};

export type AuthStatus = {
  providers?: {
    provider: string;
    authProvider?: string;
    status?: string;
    profiles?: { type?: string; status?: string; externallyManaged?: boolean; email?: string }[];
  }[];
};

/** The part of OpenClaw's config (`agents.defaults`) that says how models run. */
export type AgentDefaults = {
  model?: string | { primary?: string } | null;
  models?: Record<string, { agentRuntime?: { id?: string } | null } | null> | null;
};

const CLAUDE_PROVIDERS = new Set(["anthropic", "claude-cli"]);
const CLAUDE_CLI_RUNTIME = "claude-cli";

/**
 * Models OpenClaw runs through the local Claude Code CLI. That is how
 * `openclaw models auth login --provider anthropic --method cli` connects a
 * subscription: it marks the Anthropic models with the CLI runtime instead of
 * saving an auth profile, so `models.authStatus` alone doesn't show it.
 */
export function claudeCliModels(defaults: AgentDefaults | null | undefined): string[] {
  return Object.entries(defaults?.models ?? {})
    .filter(([, entry]) => entry?.agentRuntime?.id === CLAUDE_CLI_RUNTIME)
    .map(([ref]) => ref);
}

/** Signed in (and how), expired, or missing, from `models.authStatus` and the model config. */
export function claudeAuthFrom(status: AuthStatus | null, defaults?: AgentDefaults | null): ClaudeAuth {
  if (!status && !defaults) return { state: "unknown" };
  const providers = (status?.providers ?? []).filter(
    (p) => CLAUDE_PROVIDERS.has(p.provider) || CLAUDE_PROVIDERS.has(p.authProvider ?? ""),
  );
  const usable = providers.find((p) => p.status === "ok" || p.status === "expiring" || p.status === "static");
  if (usable) {
    const profiles = usable.profiles ?? [];
    const signedIn = profiles.find((p) => p.type === "oauth" || p.type === "token" || p.externallyManaged);
    return {
      state: "connected",
      // A sign-in profile is the subscription (Claude Code); otherwise it runs on an API key.
      method: signedIn ? "subscription" : "api_key",
      email: signedIn?.email ?? null,
    };
  }
  if (claudeCliModels(defaults).length > 0) return { state: "connected", method: "subscription", email: null };
  if (providers.some((p) => p.status === "expired")) return { state: "expired" };
  return status ? { state: "missing" } : { state: "unknown" };
}

