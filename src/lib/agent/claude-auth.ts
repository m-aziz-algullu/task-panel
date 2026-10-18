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

const CLAUDE_PROVIDERS = new Set(["anthropic", "claude-cli"]);

/** Signed in (and how), expired, or missing, from `models.authStatus`. */
export function claudeAuthFrom(status: AuthStatus | null): ClaudeAuth {
  if (!status) return { state: "unknown" };
  const providers = (status.providers ?? []).filter(
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
  if (providers.some((p) => p.status === "expired")) return { state: "expired" };
  return { state: "missing" };
}

