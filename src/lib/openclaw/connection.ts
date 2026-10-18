import "server-only";

import fs from "node:fs";
import path from "node:path";

/** Where the bundled Gateway is and how to authenticate; null when the agent is off. */
export type GatewayConnection = {
  url: string;
  token: string;
};

const DEV_SECRETS_DIR = path.join(process.cwd(), ".data", "secrets");

function devSecret(name: string): string | undefined {
  try {
    return fs.readFileSync(path.join(DEV_SECRETS_DIR, name), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The container supervisor passes these in the environment. In development,
 * `npm run agent:dev` keeps the token in ./.data/secrets instead, so the dev
 * server finds them without any .env changes.
 */
export function gatewayConnection(): GatewayConnection | null {
  const env = process.env;
  const dev = env.NODE_ENV !== "production";
  const token = env.OPENCLAW_GATEWAY_TOKEN || (dev ? devSecret("gateway-token") : undefined);
  if (!token) return null;
  const port = (dev ? devSecret("gateway-port") : undefined) || "18789";
  return {
    url: env.OPENCLAW_GATEWAY_URL || `ws://127.0.0.1:${port}`,
    token,
  };
}

export function agentEnabled(): boolean {
  return gatewayConnection() !== null;
}
