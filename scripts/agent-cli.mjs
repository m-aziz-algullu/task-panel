// `npm run agent:cli -- <openclaw args>`: OpenClaw's CLI against the development
// Gateway from `npm run agent:dev` (its HOME in ./.data/openclaw, its token and
// port), e.g. to connect Claude Code:
//
//   npm run agent:cli -- models auth login --provider anthropic --method cli --set-default
//   npm run agent:cli -- config set agents.defaults.models.anthropic/claude-sonnet-5-5.agentRuntime.id claude-cli
//   npm run agent:cli -- models set anthropic/claude-sonnet-5-5

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gatewayEnv } from "../docker/openclaw-bootstrap.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, ".data", "openclaw-runtime", "node_modules", "openclaw", "openclaw.mjs");
const secretsDir = path.join(root, ".data", "secrets");

if (!fs.existsSync(cli)) {
  console.error("Run `npm run agent:dev` first: it installs OpenClaw and starts the development Gateway.");
  process.exit(1);
}
const read = (name) => fs.readFileSync(path.join(secretsDir, name), "utf8").trim();
const env = {
  ...gatewayEnv(process.env, { home: path.join(root, ".data", "openclaw"), gatewayToken: read("gateway-token") }),
  OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${read("gateway-port")}`,
};
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
