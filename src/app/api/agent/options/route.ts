import { claudeAuthFrom, type AuthStatus } from "@/lib/agent/claude-auth";
import { agentDefaults } from "@/lib/agent/claude-status";
import { getAgentSettings } from "@/lib/agent/settings";
import { getDb } from "@/lib/db";
import { gatewayRequest, gatewayStatus } from "@/lib/openclaw/client";
import { getCurrentUser } from "@/lib/session";
import type { AgentOptions } from "@/lib/agent/options";

type ModelsList = {
  models?: { id: string; name?: string; provider?: string; thinkingLevels?: { id: string; label?: string }[] }[];
};
type AgentsList = { defaultId?: string; agents?: { id: string; name?: string; identity?: { name?: string } }[] };

// What the run panel offers: the Gateway's agents and configured models, plus the defaults.
export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getAgentSettings(await getDb());
  const [configured, agents, auth, defaults] = await Promise.all([
    gatewayRequest<ModelsList>("models.list", { view: "configured" }).catch(() => null),
    gatewayRequest<AgentsList>("agents.list", {}).catch(() => null),
    gatewayRequest<AuthStatus>("models.authStatus", {}).catch(() => null),
    agentDefaults(),
  ]);
  // The Gateway builds its catalog lazily; an empty first answer usually means it
  // hasn't discovered the providers yet, so ask once more with a refresh.
  const models = configured?.models?.length
    ? configured
    : await gatewayRequest<ModelsList>("models.list", { view: "configured", refresh: true }, { timeoutMs: 60_000 }).catch(
        () => null,
      );
  const options: AgentOptions = {
    status: gatewayStatus(),
    claude: claudeAuthFrom(auth, defaults),
    settings,
    agents: (agents?.agents ?? []).map((agent) => ({
      id: agent.id,
      name: agent.identity?.name || agent.name || agent.id,
    })),
    defaultAgentId: agents?.defaultId ?? null,
    models: (models?.models ?? []).map((model) => ({
      // OpenClaw model refs are provider/model.
      ref: model.provider ? `${model.provider}/${model.id}` : model.id,
      name: model.name || model.id,
      thinkingLevels: (model.thinkingLevels ?? []).map((level) => level.id),
    })),
  };
  return Response.json(options, { headers: { "Cache-Control": "no-store" } });
}
