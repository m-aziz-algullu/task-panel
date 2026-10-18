import "server-only";

import { gatewayRequest, gatewayStatus } from "../openclaw/client";
import { claudeAuthFrom, type AuthStatus, type ClaudeStatus } from "./claude-auth";

type ModelsList = { models?: { provider?: string }[] };

/** `refresh` makes OpenClaw re-check credentials and providers (the agent page's refresh button). */
export async function getClaudeStatus({ refresh = false } = {}): Promise<ClaudeStatus> {
  const gateway = gatewayStatus();
  if (gateway.state === "disabled") return { gateway, cliFound: null, auth: { state: "unknown" } };
  const [auth, models] = await Promise.all([
    gatewayRequest<AuthStatus>("models.authStatus", refresh ? { refresh: true } : {}, { timeoutMs: 30_000 }).catch(
      () => null,
    ),
    gatewayRequest<ModelsList>("models.list", { view: "all", ...(refresh ? { refresh: true } : {}) }, { timeoutMs: 60_000 }).catch(
      () => null,
    ),
  ]);
  return {
    gateway: gatewayStatus(),
    cliFound: models ? (models.models ?? []).some((model) => model.provider === "claude-cli") : null,
    auth: claudeAuthFrom(auth),
  };
}
