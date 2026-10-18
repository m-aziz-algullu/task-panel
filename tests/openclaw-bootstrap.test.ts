import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appEnv, ensureSecrets, gatewayEnv, managedConfig } from "../docker/openclaw-bootstrap.mjs";

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskpanel-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ensureSecrets", () => {
  it("generates the token once and reuses it on the next start", () => {
    const dir = tempDir();
    const first = ensureSecrets(dir, {});
    expect(first.gatewayToken).toMatch(/^[\w-]{43}$/);
    expect(ensureSecrets(dir, {})).toEqual(first);
  });

  it("lets the environment override the stored token", () => {
    const dir = tempDir();
    ensureSecrets(dir, {});
    expect(ensureSecrets(dir, { OPENCLAW_GATEWAY_TOKEN: "gw" })).toEqual({ gatewayToken: "gw" });
  });
});

describe("managedConfig", () => {
  it("keeps the Gateway on loopback with token auth and leaves hooks alone", () => {
    const config = Object.fromEntries(managedConfig().map((entry) => [entry.path, entry.value]));
    expect(config).toEqual({
      "gateway.mode": "local",
      "gateway.bind": "loopback",
      "gateway.port": 18789,
      "gateway.auth.mode": "token",
    });
  });
});

describe("process environments", () => {
  const base = {
    PATH: "/usr/bin",
    DATABASE_URL: "postgres://secret",
    DATABASE_POOL_SIZE: "5",
    SETUP_TOKEN: "code",
    S3_SECRET_ACCESS_KEY: "app-only",
    ANTHROPIC_API_KEY: "sk-provider",
    TELEGRAM_API_KEY: "channel",
    NODE_ENV: "production",
  };

  it("keeps the app's secrets away from the Gateway", () => {
    const env = gatewayEnv(base, { home: "/data/openclaw", gatewayToken: "gw" });
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("DATABASE_POOL_SIZE");
    expect(env).not.toHaveProperty("SETUP_TOKEN");
    // ~/.local/bin (where Claude Code installs itself) comes first, except on Windows.
    expect(env.PATH).toBe(
      process.platform === "win32" ? "/usr/bin" : [path.join("/data/openclaw", ".local", "bin"), "/usr/bin"].join(path.delimiter),
    );
    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: "sk-provider",
      TELEGRAM_API_KEY: "channel",
      NODE_ENV: "production",
      HOME: "/data/openclaw",
      OPENCLAW_HOME: "/data/openclaw",
      OPENCLAW_GATEWAY_TOKEN: "gw",
    });
  });

  it.skipIf(process.platform === "win32")("passes nothing it doesn't know on Linux", () => {
    expect(gatewayEnv(base, { home: "/data/openclaw", gatewayToken: "gw" })).not.toHaveProperty("S3_SECRET_ACCESS_KEY");
  });

  it("tells the app where the Gateway is", () => {
    expect(appEnv(base, { gatewayToken: "gw", appPort: 3000 })).toMatchObject({
      DATABASE_URL: "postgres://secret",
      OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
      OPENCLAW_GATEWAY_TOKEN: "gw",
      TASKPANEL_INTERNAL_URL: "http://127.0.0.1:3000",
    });
  });
});

describe("OpenClaw version", () => {
  it("is the same in the Dockerfile and package.json", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    const imageVersion = dockerfile.match(/^ARG OPENCLAW_VERSION=(\S+)$/m)?.[1];
    expect(imageVersion).toBeDefined();
    expect(pkg.dependencies["@openclaw/gateway-client"]).toBe(imageVersion);
    expect(pkg.dependencies["@openclaw/gateway-protocol"]).toBe(imageVersion);
  });
});
