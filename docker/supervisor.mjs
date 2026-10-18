// PID 1's child in the agent image (tini → this): starts the bundled OpenClaw
// Gateway and the Task Panel server in one container and keeps them running.
//
// - The Gateway runs as `node` with its HOME on the /data volume, so its config,
//   sessions, memory, provider keys and installed skills survive redeploys. It
//   listens on loopback only and never sees DATABASE_URL.
// - Task Panel runs as `nextjs`; another uid, so the agent's shell can't read its
//   environment through /proc.
// - A crashed Gateway is restarted with backoff while the app stays up. If the
//   app exits, the container exits and the restart policy takes over.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  GATEWAY_PORT,
  appEnv,
  applyManagedConfig,
  ensureSecrets,
  gatewayEnv,
} from "./openclaw-bootstrap.mjs";

const DATA_DIR = process.env.TASKPANEL_DATA_DIR || "/data";
const OPENCLAW_HOME = path.join(DATA_DIR, "openclaw");
const SECRETS_DIR = path.join(DATA_DIR, "secrets");
const OPENCLAW_ROOT = "/app";
const APP_DIR = "/srv/task-panel";
const APP_PORT = Number(process.env.PORT) || 3000;
const agentEnabled = !/^(0|false|off|no)$/i.test(process.env.TASKPANEL_AGENT ?? "");

function log(message) {
  console.log(`[supervisor] ${message}`);
}

function account(name) {
  const line = fs
    .readFileSync("/etc/passwd", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}:`));
  if (!line) throw new Error(`user ${name} not found`);
  const [, , uid, gid] = line.split(":");
  return { uid: Number(uid), gid: Number(gid) };
}

function isMountPoint(dir) {
  try {
    // Field 5 of each mountinfo line is the mount point.
    return fs
      .readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      .some((line) => line.split(" ")[4] === dir);
  } catch {
    return false;
  }
}

function pipeWithPrefix(stream, prefix, target) {
  readline.createInterface({ input: stream }).on("line", (line) => target.write(`${prefix} ${line}\n`));
}

function start(name, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  pipeWithPrefix(child.stdout, `[${name}]`, process.stdout);
  pipeWithPrefix(child.stderr, `[${name}]`, process.stderr);
  return child;
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let stopping = false;
let app;
let gateway;
let gatewayRestartTimer;

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(gatewayRestartTimer);
  app?.kill("SIGTERM");
  await waitForExit(app, 10_000);
  gateway?.kill("SIGTERM");
  // OpenClaw drains in-flight runs and flushes its databases on SIGTERM.
  await waitForExit(gateway, 30_000);
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => shutdown(0));

let secrets;
let ephemeral = false;
if (agentEnabled) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!isMountPoint(DATA_DIR)) {
    ephemeral = true;
    log("=".repeat(72));
    log(`WARNING: ${DATA_DIR} is not a mounted volume. The agent's memory, sessions,`);
    log("provider keys and skills will be lost on the next deploy. Mount a volume at");
    log(`${DATA_DIR} (Dokploy: Advanced → Volumes; docker run -v task-panel-data:${DATA_DIR}).`);
    log("=".repeat(72));
  }

  const node = account("node");
  fs.mkdirSync(OPENCLAW_HOME, { recursive: true, mode: 0o700 });
  fs.chownSync(OPENCLAW_HOME, node.uid, node.gid);
  secrets = ensureSecrets(SECRETS_DIR);
  // Owned by the Gateway's user, so `agent-shell.sh` can run OpenClaw's CLI. The
  // agent already shares that uid with the Gateway, which holds the token.
  fs.chmodSync(SECRETS_DIR, 0o700);
  for (const entry of [SECRETS_DIR, ...fs.readdirSync(SECRETS_DIR).map((name) => path.join(SECRETS_DIR, name))]) {
    fs.chownSync(entry, node.uid, node.gid);
  }

  const env = gatewayEnv(process.env, { home: OPENCLAW_HOME, gatewayToken: secrets.gatewayToken });
  try {
    applyManagedConfig({
      command: [process.execPath, path.join(OPENCLAW_ROOT, "openclaw.mjs")],
      port: GATEWAY_PORT,
      env,
      uid: node.uid,
      gid: node.gid,
      cwd: OPENCLAW_ROOT,
    });
  } catch (error) {
    // Keep going: the Gateway may still start with the config from last time.
    log(`Could not apply Task Panel's Gateway settings: ${error.message}`);
  }

  let backoffMs = 1_000;
  const startGateway = () => {
    const startedAt = Date.now();
    // Through OpenClaw's own image entrypoint, which migrates retained state
    // (`doctor --fix`) before handing over to the Gateway.
    gateway = start(
      "openclaw",
      process.execPath,
      [path.join(OPENCLAW_ROOT, "docker-entrypoint.mjs"), process.execPath, path.join(OPENCLAW_ROOT, "openclaw.mjs"), "gateway"],
      { cwd: OPENCLAW_ROOT, env, uid: node.uid, gid: node.gid },
    );
    gateway.on("exit", (code, signal) => {
      if (stopping) return;
      if (Date.now() - startedAt > 60_000) backoffMs = 1_000;
      log(`OpenClaw exited (${signal ?? code}); restarting in ${Math.round(backoffMs / 1000)} s.`);
      gatewayRestartTimer = setTimeout(startGateway, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  };
  startGateway();
} else {
  log("TASKPANEL_AGENT is off: starting Task Panel without OpenClaw.");
}

const nextjs = account("nextjs");
app = start("app", process.execPath, [path.join(APP_DIR, "server.js")], {
  cwd: APP_DIR,
  uid: nextjs.uid,
  gid: nextjs.gid,
  env: {
    ...(secrets
      ? appEnv(process.env, { ...secrets, port: GATEWAY_PORT, appPort: APP_PORT })
      : process.env),
    HOME: APP_DIR,
    // The agent page warns that nothing is persisted.
    ...(ephemeral ? { TASKPANEL_DATA_EPHEMERAL: "1" } : {}),
  },
});
app.on("exit", (code, signal) => {
  if (stopping) return;
  log(`Task Panel exited (${signal ?? code}); stopping the container.`);
  shutdown(code || 1);
});
