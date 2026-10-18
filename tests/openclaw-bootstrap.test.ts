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
  it("generates the tokens once and reuses them on the next start", () => {
    const dir = tempDir();
    const first = ensureSecrets(dir, {});
    expect(first.gatewayToken).toMatch(/^[\w-]{43}$/);
    expect(first.hooksToken).not.toBe(first.gatewayToken);
    expect(ensureSecrets(dir, {})).toEqual(first);
  });

  it("lets the environment override the stored tokens", () => {
    const dir = tempDir();
    ensureSecrets(dir, {});
    expect(ensureSecrets(dir, { OPENCLAW_GATEWAY_TOKEN: "gw", OPENCLAW_HOOKS_TOKEN: "hk" })).toEqual({
      gatewayToken: "gw",
      hooksToken: "hk",
    });
  });

  it("refuses one value for both tokens", () => {
    expect(() => ensureSecrets(tempDir(), { OPENCLAW_GATEWAY_TOKEN: "same", OPENCLAW_HOOKS_TOKEN: "same" })).toThrow();
  });
});

describe("managedConfig", () => {
  it("keeps the Gateway on loopback and only admits Task Panel's session keys", () => {
    const config = Object.fromEntries(managedConfig({ hooksToken: "hk" }).map((entry) => [entry.path, entry.value]));
    expect(config["gateway.bind"]).toBe("loopback");
    expect(config["hooks.token"]).toBe("hk");
    expect(config["hooks.allowedSessionKeyPrefixes"]).toEqual(["hook:", "taskpanel:"]);
  });
});

describe("process environments", () => {
  const base = {
    PATH: "/usr/bin",
    DATABASE_URL: "postgres://secret",
    DATABASE_POOL_SIZE: "5",
    SETUP_TOKEN: "code",
    ANTHROPIC_API_KEY: "sk-provider",
  };

  it("keeps the app's secrets away from the Gateway", () => {
    const env = gatewayEnv({ ...base, OPENCLAW_HOOKS_TOKEN: "hk" }, { home: "/data/openclaw", gatewayToken: "gw" });
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("DATABASE_POOL_SIZE");
    expect(env).not.toHaveProperty("SETUP_TOKEN");
    expect(env).not.toHaveProperty("OPENCLAW_HOOKS_TOKEN");
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-provider",
      HOME: "/data/openclaw",
      OPENCLAW_HOME: "/data/openclaw",
      OPENCLAW_GATEWAY_TOKEN: "gw",
    });
  });

  it("tells the app where the Gateway and the hooks are", () => {
    expect(appEnv(base, { gatewayToken: "gw", hooksToken: "hk", appPort: 3000 })).toMatchObject({
      DATABASE_URL: "postgres://secret",
      OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
      OPENCLAW_HOOKS_URL: "http://127.0.0.1:18789/hooks",
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
