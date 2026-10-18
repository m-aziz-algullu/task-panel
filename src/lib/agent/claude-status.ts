import "server-only";

import { gatewayRequest, gatewayStatus } from "../openclaw/client";
import { claudeAuthFrom, claudeCliModels, type AgentDefaults, type AuthStatus, type ClaudeStatus } from "./claude-auth";

type ModelsList = { models?: { provider?: string }[] };
type ConfigSnapshot = { config?: { agents?: { defaults?: AgentDefaults } } };

/** OpenClaw's `agents.defaults`, where a CLI-connected subscription shows up. */
export async function agentDefaults(): Promise<AgentDefaults | null> {
  const snapshot = await gatewayRequest<ConfigSnapshot>("config.get", {}, { timeoutMs: 30_000 }).catch(() => null);
  return snapshot?.config?.agents?.defaults ?? null;
}

/** `refresh` makes OpenClaw re-check credentials and providers (the agent page's refresh button). */
export async function getClaudeStatus({ refresh = false } = {}): Promise<ClaudeStatus> {
  const gateway = gatewayStatus();
  if (gateway.state === "disabled") return { gateway, cliFound: null, auth: { state: "unknown" } };
  const [auth, models, defaults] = await Promise.all([
    gatewayRequest<AuthStatus>("models.authStatus", refresh ? { refresh: true } : {}, { timeoutMs: 30_000 }).catch(
      () => null,
    ),
    gatewayRequest<ModelsList>("models.list", { view: "all", ...(refresh ? { refresh: true } : {}) }, { timeoutMs: 60_000 }).catch(
      () => null,
    ),
    agentDefaults(),
  ]);
  // Before it's connected the CLI shows up as its own provider; connecting moves
  // those models over to Anthropic with the CLI runtime.
  const cliListed = models ? (models.models ?? []).some((model) => model.provider === "claude-cli") : null;
  return {
    gateway: gatewayStatus(),
    cliFound: cliListed || claudeCliModels(defaults).length > 0 ? true : cliListed,
    auth: claudeAuthFrom(auth, defaults),
  };
}
