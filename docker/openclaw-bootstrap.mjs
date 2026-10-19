// Shared by the container supervisor and `npm run agent:dev`: everything that has
// to be in place before the bundled OpenClaw Gateway starts. Node built-ins only,
// since this runs outside the Next.js bundle.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GATEWAY_PORT = 18789;
/** Prefix of the session keys Task Panel gives agent runs (src/lib/types.ts has the same). */
export const SESSION_KEY_PREFIX = "taskpanel:";

/**
 * The Gateway token, generated once and kept under `secretsDir` so it survives
 * restarts. OPENCLAW_GATEWAY_TOKEN in the environment wins over the stored one.
 *
 * @param {string} secretsDir
 * @param {Record<string, string | undefined>} [env]
 */
export function ensureSecrets(secretsDir, env = process.env) {
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  if (env.OPENCLAW_GATEWAY_TOKEN) return { gatewayToken: env.OPENCLAW_GATEWAY_TOKEN };
  const file = path.join(secretsDir, "gateway-token");
  try {
    const stored = fs.readFileSync(file, "utf8").trim();
    if (stored) return { gatewayToken: stored };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const gatewayToken = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(file, `${gatewayToken}\n`, { mode: 0o600 });
  return { gatewayToken };
}

/**
 * The agent's tools: files and the shell, web search and fetch, its memory, goals
 * (the soft token limit), PDFs and images, and skills. No browser, sessions,
 * canvas, media generation or Gateway administration. Claude Code's own tools
 * are held to the same list.
 */
export const AGENT_TOOLS = [
  "ls",
  "read",
  "write",
  "edit",
  "apply_patch",
  "exec",
  "process",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "create_goal",
  "get_goal",
  "update_goal",
  "pdf",
  "view_image",
  "skills_search",
  "skills_read",
];

/** OpenClaw's bundled skills the agent keeps; skills the user installs are not affected. */
export const AGENT_BUNDLED_SKILLS = ["clawhub", "github", "gh-issues", "notion", "skill-creator", "weather"];

/** Skills that come with plugins rather than bundled, for tools the agent doesn't have. */
const PLUGIN_SKILLS_OFF = ["browser-automation", "canvas"];

export const AGENT_CONTEXT_TOKENS = 150_000;

/** OpenClaw fills in the rest of each entry from its catalog. */
const CAPPED_MODELS = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
];

/**
 * Config keys Task Panel owns. Written on every start so the Gateway always
 * listens where the app expects it, on loopback only; every other key belongs to
 * the user (and the agent settings page) and is never touched here. The token
 * comes from OPENCLAW_GATEWAY_TOKEN, so it never lands in openclaw.json.
 *
 * In the container the agent's Chromium keeps shared memory out of Docker's
 * 64 MB /dev/shm and, unless `browserSandbox` is set, runs without its own
 * sandbox: that needs privileges Docker doesn't grant by default, and Chromium
 * aborts at launch without them. The container, the unprivileged `node` user
 * and a separate browser profile still fence it in.
 */
export function managedConfig({ port = GATEWAY_PORT, container = false, browserSandbox = false } = {}) {
  return [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "loopback" },
    { path: "gateway.port", value: port },
    { path: "gateway.auth.mode", value: "token" },
    // Every model call carries the definitions of every tool and bundled skill the
    // agent has, so it gets only what Task Panel's work needs.
    { path: "tools.allow", value: AGENT_TOOLS },
    { path: "skills.allowBundled", value: AGENT_BUNDLED_SKILLS },
    ...PLUGIN_SKILLS_OFF.map((name) => ({ path: `skills.entries.${name}.enabled`, value: false })),
    // Claude Code compacts the conversation at this size instead of letting it
    // grow to the model's 1M window, which every later step would re-read.
    {
      path: "models.providers.anthropic.models",
      value: CAPPED_MODELS.map((model) => ({ ...model, contextTokens: AGENT_CONTEXT_TOKENS })),
    },
    ...(container
      ? [
          { path: "browser.noSandbox", value: !browserSandbox },
          { path: "browser.extraArgs", value: ["--disable-dev-shm-usage"] },
        ]
      : []),
  ];
}

/** Config keys Task Panel manages; the settings page shows them read-only. */
export const MANAGED_CONFIG_PATHS = managedConfig({ container: true }).map((entry) => entry.path);

/**
 * Applies `managedConfig` with OpenClaw's own CLI, so validation and file format
 * stay OpenClaw's business. `command` is the argv prefix that runs the CLI
 * (node plus openclaw.mjs; no shell involved).
 */
export function applyManagedConfig({ command, port, container, browserSandbox, env, uid, gid, cwd }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskpanel-openclaw-"));
  const batchFile = path.join(dir, "config.batch.json");
  try {
    fs.writeFileSync(batchFile, JSON.stringify(managedConfig({ port, container, browserSandbox })), { mode: 0o600 });
    if (uid !== undefined) {
      fs.chownSync(dir, uid, gid);
      fs.chownSync(batchFile, uid, gid);
    }
    const result = runCli({ command, env, uid, gid, cwd }, ["config", "set", "--batch-file", batchFile]);
    if (result.status !== 0) throw cliError("config set", result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli({ command, env, uid, gid, cwd }, args, timeout = 60_000) {
  const [program, ...prefix] = command;
  const result = spawnSync(program, [...prefix, ...args], { env, uid, gid, cwd, encoding: "utf8", timeout });
  if (result.error) throw result.error;
  return result;
}

function cliError(what, result) {
  return new Error(`openclaw ${what} exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
}

/** Key-free web search for the agent, so it doesn't open web pages in a browser to look things up. */
export const SEARCH_PLUGIN = { id: "parallel", spec: "@openclaw/parallel-plugin", provider: "parallel-free" };

/**
 * Installs the search plugin (same version as OpenClaw) when it's missing and
 * selects its free provider when no search provider is set. A provider the user
 * picked is left alone. Returns what it did, for the log.
 */
export function ensureWebSearch({ command, version, env, uid, gid, cwd }) {
  const options = { command, env, uid, gid, cwd };
  const done = [];
  const list = runCli(options, ["plugins", "list", "--json"]);
  if (list.status !== 0) throw cliError("plugins list", list);
  const { plugins = [] } = JSON.parse(list.stdout.slice(list.stdout.indexOf("{")));
  if (!plugins.some((plugin) => plugin.id === SEARCH_PLUGIN.id)) {
    const install = runCli(options, ["plugins", "install", `${SEARCH_PLUGIN.spec}@${version}`], 5 * 60_000);
    if (install.status !== 0) throw cliError("plugins install", install);
    done.push(`installed ${SEARCH_PLUGIN.spec}@${version}`);
  }
  const current = runCli(options, ["config", "get", "tools.web.search.provider", "--json"]);
  if (current.status !== 0 && /unset/i.test(current.stdout + current.stderr)) {
    const set = runCli(options, [
      "config",
      "set",
      "tools.web.search.provider",
      JSON.stringify(SEARCH_PLUGIN.provider),
      "--strict-json",
      "--expect-current-absent",
    ]);
    if (set.status !== 0) throw cliError("config set", set);
    done.push(`web search provider set to ${SEARCH_PLUGIN.provider}`);
  }
  return done;
}

/**
 * Variables the Gateway (and so the agent's shell) may see in the container: the
 * runtime's own, proxies, OpenClaw's and model providers' keys. Anything else the
 * app is given (DATABASE_URL, SETUP_TOKEN, keys added later) stays with the app.
 */
const GATEWAY_ENV_ALLOWED =
  /^(PATH|TZ|LANG|LANGUAGE|TERM|DISPLAY|SHELL|USER|LOGNAME|https?_proxy|HTTPS?_PROXY|no_proxy|NO_PROXY)$|^(LC_|NODE_|COREPACK_|PLAYWRIGHT_|XDG_|OPENCLAW_|ANTHROPIC_|OPENAI_|GOOGLE_|GEMINI_|XAI_|OPENROUTER_|OLLAMA_)|_API_KEYS?(_\w+)?$/;

/** Never passed on, whatever the allowlist says. */
const GATEWAY_ENV_DENIED = /^(DATABASE_|PGLITE_|SETUP_TOKEN$|TASKPANEL_)/;

/** Environment for the Gateway process: the app's own secrets stay out of the agent's reach. */
export function gatewayEnv(base, { home, gatewayToken }) {
  // Windows (local development only) needs its system variables to run Node at all.
  const allowed = (name) =>
    !GATEWAY_ENV_DENIED.test(name) && (process.platform === "win32" || GATEWAY_ENV_ALLOWED.test(name));
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => allowed(name)));
  return {
    ...env,
    // Tools installed under the Gateway's home (Claude Code's native installer puts
    // `claude` in ~/.local/bin) live on the volume and come first. Windows keeps its
    // own PATH: there `claude` is already installed for the signed-in user.
    ...(process.platform === "win32"
      ? {}
      : { PATH: [path.join(home, ".local", "bin"), env.PATH].filter(Boolean).join(path.delimiter) }),
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };
}

/** What the Next.js server needs to reach the Gateway. */
export function appEnv(base, { gatewayToken, port = GATEWAY_PORT }) {
  return {
    ...base,
    OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${port}`,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };
}
