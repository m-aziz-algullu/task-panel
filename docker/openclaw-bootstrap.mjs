// Shared by the container supervisor and `npm run agent:dev`: everything that has
// to be in place before the bundled OpenClaw Gateway starts. Node built-ins only,
// since this runs outside the Next.js bundle.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GATEWAY_PORT = 18789;
/** Run session keys Task Panel creates; the Gateway refuses any other caller-chosen key. */
export const SESSION_KEY_PREFIX = "taskpanel:";

/**
 * The Gateway and hook tokens, generated once and kept under `secretsDir` so they
 * survive restarts. A value set in the environment wins over the stored one.
 *
 * @param {string} secretsDir
 * @param {Record<string, string | undefined>} [env]
 */
export function ensureSecrets(secretsDir, env = process.env) {
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const read = (name, envName) => {
    if (env[envName]) return env[envName];
    const file = path.join(secretsDir, name);
    try {
      const stored = fs.readFileSync(file, "utf8").trim();
      if (stored) return stored;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const value = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
    return value;
  };
  const gatewayToken = read("gateway-token", "OPENCLAW_GATEWAY_TOKEN");
  const hooksToken = read("hooks-token", "OPENCLAW_HOOKS_TOKEN");
  // OpenClaw rejects a hook token that doubles as the Gateway credential.
  if (gatewayToken === hooksToken) throw new Error("OPENCLAW_HOOKS_TOKEN must differ from OPENCLAW_GATEWAY_TOKEN");
  return { gatewayToken, hooksToken };
}

/**
 * Config keys Task Panel owns. Written on every start so the Gateway always
 * listens where the app expects it; every other key belongs to the user (and the
 * agent settings page) and is never touched here. The Gateway token itself comes
 * from OPENCLAW_GATEWAY_TOKEN, so it never lands in openclaw.json.
 */
export function managedConfig({ hooksToken, port = GATEWAY_PORT }) {
  return [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "loopback" },
    { path: "gateway.port", value: port },
    { path: "gateway.auth.mode", value: "token" },
    { path: "hooks.enabled", value: true },
    { path: "hooks.path", value: "/hooks" },
    { path: "hooks.token", value: hooksToken },
    { path: "hooks.allowRequestSessionKey", value: true },
    // "hook:" keeps the Gateway's own generated keys valid; it refuses to start without it.
    { path: "hooks.allowedSessionKeyPrefixes", value: ["hook:", SESSION_KEY_PREFIX] },
  ];
}

/** Top-level config keys Task Panel manages; the settings page shows them read-only. */
export const MANAGED_CONFIG_PATHS = managedConfig({ hooksToken: "" }).map((entry) => entry.path);

/**
 * Applies `managedConfig` with OpenClaw's own CLI, so validation and file format
 * stay OpenClaw's business. `command` is the argv prefix that runs the CLI
 * (node plus openclaw.mjs; no shell involved).
 */
export function applyManagedConfig({ command, hooksToken, port, env, uid, gid, cwd }) {
  // A file rather than --batch-json keeps the hook token out of the process list.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskpanel-openclaw-"));
  const batchFile = path.join(dir, "config.batch.json");
  try {
    fs.writeFileSync(batchFile, JSON.stringify(managedConfig({ hooksToken, port })), { mode: 0o600 });
    if (uid !== undefined) {
      fs.chownSync(dir, uid, gid);
      fs.chownSync(batchFile, uid, gid);
    }
    const [program, ...args] = command;
    const result = spawnSync(program, [...args, "config", "set", "--batch-file", batchFile], {
      env,
      uid,
      gid,
      cwd,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`openclaw config set exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Environment for the Gateway process: the app's own secrets stay out of the agent's reach. */
export function gatewayEnv(base, { home, gatewayToken }) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (/^(DATABASE_|PGLITE_|SETUP_TOKEN$|TASKPANEL_|OPENCLAW_HOOKS_TOKEN$)/.test(name)) delete env[name];
  }
  return {
    ...env,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };
}

/** What the Next.js server needs to reach the Gateway and to tell the agent where it lives. */
export function appEnv(base, { gatewayToken, hooksToken, port = GATEWAY_PORT, appPort }) {
  return {
    ...base,
    OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${port}`,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_HOOKS_URL: `http://127.0.0.1:${port}/hooks`,
    OPENCLAW_HOOKS_TOKEN: hooksToken,
    TASKPANEL_INTERNAL_URL: `http://127.0.0.1:${appPort}`,
  };
}
