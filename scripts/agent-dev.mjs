// `npm run agent:dev`: the bundled OpenClaw Gateway for local development, set up
// the same way the container supervisor does it. Run it next to `npm run dev`.
//
// Everything lives in ./.data: OpenClaw itself is installed once into
// ./.data/openclaw-runtime and the Gateway's HOME is ./.data/openclaw, so your own
// ~/.openclaw is never touched. In development the app reads the tokens from
// ./.data/secrets, so no .env changes are needed.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyManagedConfig, ensureSecrets, ensureWebSearch, gatewayEnv } from "../docker/openclaw-bootstrap.mjs";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// One version for the Gateway and the client library talking to it.
const version = pkg.dependencies["@openclaw/gateway-client"];
const runtimeDir = path.join(root, ".data", "openclaw-runtime");
const home = path.join(root, ".data", "openclaw");
const secretsDir = path.join(root, ".data", "secrets");
const cli = path.join(runtimeDir, "node_modules", "openclaw", "openclaw.mjs");
// Not OpenClaw's default 18789, so a personal OpenClaw on the same machine keeps its port.
const port = Number(process.env.OPENCLAW_DEV_PORT) || 18799;

function installedVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(runtimeDir, "node_modules", "openclaw", "package.json"), "utf8"))
      .version;
  } catch {
    return null;
  }
}

if (installedVersion() !== version) {
  console.log(`[agent:dev] Installing OpenClaw ${version} into ${path.relative(root, runtimeDir)} (once)…`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const install = spawnSync("npm", ["install", "--prefix", runtimeDir, "--no-save", "--no-fund", `openclaw@${version}`], {
    stdio: "inherit",
    // npm on Windows is a .cmd shim; every argument here is shell-safe.
    shell: process.platform === "win32",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

fs.mkdirSync(home, { recursive: true });
const secrets = ensureSecrets(secretsDir);
// The dev server reads the address from here (src/lib/openclaw/connection.ts).
fs.writeFileSync(path.join(secretsDir, "gateway-port"), `${port}\n`);
const env = gatewayEnv(process.env, { home, gatewayToken: secrets.gatewayToken });
const command = [process.execPath, cli];

console.log(`[agent:dev] OpenClaw ${version}, HOME=${path.relative(root, home)}`);
applyManagedConfig({ command, port, env, cwd: root });
try {
  for (const step of ensureWebSearch({ command, version, env, cwd: root })) console.log(`[agent:dev] ${step}`);
} catch (error) {
  console.log(`[agent:dev] Could not set up web search: ${error.message}`);
}

const gateway = spawn(process.execPath, [cli, "gateway"], { cwd: root, env, stdio: "inherit" });
console.log(`[agent:dev] Gateway starting on 127.0.0.1:${port}; stop with Ctrl+C.`);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => gateway.kill(signal));
gateway.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
