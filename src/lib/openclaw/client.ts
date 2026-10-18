import "server-only";

import { GatewayClient, type GatewayClientRequestOptions } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { gatewayConnection } from "./connection";

export type GatewayState = "disabled" | "connecting" | "ready" | "error";

export type GatewayStatus = {
  state: GatewayState;
  /** OpenClaw version reported by the Gateway once connected. */
  version: string | null;
  error: string | null;
};

/** The agent is off, or the Gateway isn't reachable right now. */
export class GatewayUnavailableError extends Error {
  constructor(message = "OpenClaw Gateway is not connected") {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

type Holder = {
  client: GatewayClient;
  status: GatewayStatus;
  ready: PromiseWithResolvers<void>;
};

// One connection per server process (and across dev hot reloads), like the database.
const globalForGateway = globalThis as unknown as { taskPanelGateway?: Holder };

function connect(): Holder | null {
  if (globalForGateway.taskPanelGateway) return globalForGateway.taskPanelGateway;
  const connection = gatewayConnection();
  if (!connection) return null;

  const holder: Holder = {
    status: { state: "connecting", version: null, error: null },
    ready: Promise.withResolvers<void>(),
    client: undefined as unknown as GatewayClient,
  };
  // Callers waiting on `ready` time out on their own; never an unhandled rejection.
  holder.ready.promise.catch(() => {});

  holder.client = new GatewayClient({
    url: connection.url,
    token: connection.token,
    // Loopback backend identity: the Gateway grants its scopes without device pairing.
    clientName: "gateway-client",
    clientDisplayName: "Task Panel",
    clientVersion: process.env.npm_package_version || "task-panel",
    platform: process.platform,
    mode: "backend",
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    onHelloOk: (hello) => {
      holder.status = { state: "ready", version: hello.server?.version ?? null, error: null };
      holder.ready.resolve();
    },
    onConnectError: (error) => {
      holder.status = { ...holder.status, state: "error", error: error.message };
    },
    onClose: () => {
      if (holder.status.state === "ready") {
        holder.status = { ...holder.status, state: "connecting" };
        holder.ready = Promise.withResolvers<void>();
        holder.ready.promise.catch(() => {});
      }
    },
  });
  holder.client.start();
  globalForGateway.taskPanelGateway = holder;
  return holder;
}

export function gatewayStatus(): GatewayStatus {
  return connect()?.status ?? { state: "disabled", version: null, error: null };
}

/** Starts connecting in the background (server startup), so the first request doesn't wait. */
export function warmGateway(): void {
  connect();
}

/**
 * A Gateway RPC. Waits up to `connectTimeoutMs` for the connection (the Gateway
 * may still be starting next to the app), then throws GatewayUnavailableError.
 */
export async function gatewayRequest<T = Record<string, unknown>>(
  method: string,
  params: unknown = {},
  { connectTimeoutMs = 5_000, ...options }: GatewayClientRequestOptions & { connectTimeoutMs?: number } = {},
): Promise<T> {
  const holder = connect();
  if (!holder) throw new GatewayUnavailableError("The agent is not enabled");
  if (holder.status.state !== "ready") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), connectTimeoutMs);
    });
    const outcome = await Promise.race([holder.ready.promise.then(() => "ready" as const), timedOut]);
    clearTimeout(timer);
    if (outcome === "timeout") throw new GatewayUnavailableError(holder.status.error ?? undefined);
  }
  return holder.client.request<T>(method, params, options);
}
