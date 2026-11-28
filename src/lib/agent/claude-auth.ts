// OpenClaw's view of Claude access, reduced to what the UI shows. Shared by the
// server and the agent page; Task Panel never sees Claude credentials.

import type { GatewayStatus } from "../openclaw/client";

/**
 * The last time Task Panel saw whether Claude actually answers: a real turn (a task
 * run, or the sign-in check on the agent page) that got a reply or failed to
 * authenticate. OpenClaw's config only says a sign-in was set up; it can't tell
 * whether the session behind it can still be refreshed. Stored in `app_settings`.
 */
export type ClaudeHealth = {
  ok: boolean;
  /** ISO time of the observation. */
  at: string;
  source: "run" | "check";
  /** What Claude Code said when it refused; only when `ok` is false. */
  error: string | null;
};

/** How OpenClaw reaches Claude: the user's own subscription through Claude Code, or an API key. */
export type ClaudeAuth =
  | {
      state: "connected";
      method: "subscription" | "api_key";
      email: string | null;
      /** When a real turn last went through; null if none has since the sign-in was set up. */
      verifiedAt: string | null;
    }
  | {
      state: "expired";
      /** Seen by a real turn (with when and what Claude said), or reported by OpenClaw itself. */
      source: "run" | "check" | "openclaw";
      at: string | null;
      error: string | null;
    }
  | { state: "missing" | "unknown" };

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

/**
 * Claude Code's own words when its sign-in is gone (the same patterns OpenClaw uses
 * to classify a claude-cli failure as an auth error): the OAuth session expired and
 * its refresh token was refused, the user signed out, or the credentials were revoked.
 */
const CLAUDE_AUTH_ERROR =
  /\bnot logged in\b|please run \/login\b|failed to authenticate|oauth session expired|could not be refreshed|oauth token refresh failed|invalid authentication credentials|authentication_error/i;

export function isClaudeAuthError(text: string | null | undefined): boolean {
  return !!text && CLAUDE_AUTH_ERROR.test(text);
}

/** How long a successful turn counts as proof that the sign-in still works. */
export const CLAUDE_VERIFY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** A failed turn is retried by the agent page no sooner than this (a failing check costs no tokens). */
export const CLAUDE_RECHECK_FAILED_MS = 60 * 1000;

/**
 * Whether the agent page should check the sign-in by itself (one tiny real turn):
 * it looks signed in but nothing has proven it lately, or a turn found it expired
 * and the user may have signed in again since.
 */
export function needsVerification(auth: ClaudeAuth, now: number, maxAgeMs = CLAUDE_VERIFY_MAX_AGE_MS): boolean {
  if (auth.state === "connected") {
    return !auth.verifiedAt || now - new Date(auth.verifiedAt).getTime() > maxAgeMs;
  }
  if (auth.state === "expired" && auth.source !== "openclaw") {
    return !auth.at || now - new Date(auth.at).getTime() > CLAUDE_RECHECK_FAILED_MS;
  }
  return false;
}

/**
 * Signed in (and how), expired, or missing: what OpenClaw's `models.authStatus` and
 * model config say was set up, corrected by what the last real turn saw. A sign-in
 * set up through the Claude Code CLI always looks connected in the config, even
 * after its OAuth session died, so a failed turn is what marks it expired, until a
 * later turn goes through again.
 */
export function claudeAuthFrom(
  status: AuthStatus | null,
  defaults?: AgentDefaults | null,
  health?: ClaudeHealth | null,
): ClaudeAuth {
  const configured = configuredAuth(status, defaults);
  if (!health || (configured.state !== "connected" && configured.state !== "expired")) return configured;
  if (!health.ok) return { state: "expired", source: health.source, at: health.at, error: health.error };
  if (configured.state === "connected") return { ...configured, verifiedAt: health.at };
  return configured;
}

function configuredAuth(status: AuthStatus | null, defaults?: AgentDefaults | null): ClaudeAuth {
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
      verifiedAt: null,
    };
  }
  if (claudeCliModels(defaults).length > 0) {
    return { state: "connected", method: "subscription", email: null, verifiedAt: null };
  }
  if (providers.some((p) => p.status === "expired")) return { state: "expired", source: "openclaw", at: null, error: null };
  return status ? { state: "missing" } : { state: "unknown" };
}

