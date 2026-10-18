// Shape of GET /api/agent/options, shared with the run panel.

import type { GatewayStatus } from "../openclaw/client";
import type { ClaudeAuth } from "./claude-auth";
import type { AgentSettings } from "./settings-shape";

export type AgentOptions = {
  status: GatewayStatus;
  /** Whether OpenClaw can reach Claude (the user's own subscription or an API key). */
  claude: ClaudeAuth;
  settings: AgentSettings;
  agents: { id: string; name: string }[];
  defaultAgentId: string | null;
  /** `ref` is what a run's model override takes (provider/model). */
  models: { ref: string; name: string; thinkingLevels: string[] }[];
};
