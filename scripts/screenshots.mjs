// Re-takes the README screenshots in docs/screenshots from a fresh, throwaway
// database filled with demo data, so they always show the current UI.
//
//   npm run screenshots              # all of them
//   npm run screenshots -- board     # only the ones whose name contains "board"
//
// Needs Playwright with Chromium (not a dependency of the app):
//   npm i -g playwright && npx playwright install chromium
//
// The agent screenshots (agent-*, openclaw-*) need a live OpenClaw Gateway and a
// signed-in model, so this script leaves them alone; take those by hand.

import { spawn } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/screenshots");
const PORT = Number(process.env.SCREENSHOT_PORT) || 3123;
const BASE = `http://localhost:${PORT}`;
const SETUP_CODE = "DEMO-SHOT-CODE-0001";
const TZ = "Europe/Istanbul";
const only = process.argv[2] ?? "";

function loadPlaywright() {
  try {
    // createRequire honours NODE_PATH, so a global install works too.
    return createRequire(import.meta.url)("playwright");
  } catch {
    console.error("Playwright is missing: npm i -g playwright && npx playwright install chromium");
    process.exit(1);
  }
}

// ---------------------------------------------------------------- demo data

/** YYYY-MM-DD in the app's time zone, `offset` days from today. */
function day(offset = 0) {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const iso = (offsetDays = 0, hour = 9) => new Date(`${day(offsetDays)}T${String(hour).padStart(2, "0")}:00:00+03:00`).toISOString();

const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
const doc = (...content) => ({ type: "doc", content });
const checklist = (...items) => ({
  type: "taskList",
  content: items.map(([checked, label]) => ({ type: "taskItem", attrs: { checked }, content: [paragraph(label)] })),
});

const TAGS = { agent: 1, health: 2, learning: 3, side: 4, work: 5 };

function demoBackup() {
  const created = iso(-3);
  let id = 7;
  const task = (status, title, extra = {}) => ({
    id: ++id,
    title,
    descriptionDoc: null,
    status,
    storyPoints: 2,
    day: day(0),
    dueDate: day(3),
    position: id,
    createdAt: created,
    updatedAt: created,
    completedAt: status === "done" ? iso(0, 11) : null,
    tagIds: [],
    comments: [],
    ...extra,
  });
  const routine = (rid, title, body, schedule, handToAgent = false) => ({
    id: rid,
    title,
    body,
    schedule,
    handToAgent,
    lastRunAt: null,
    createdAt: created,
    updatedAt: created,
  });

  return {
    format: "task-panel-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      tags: [
        { id: TAGS.agent, name: "Agent", color: "#7c3aed", createdAt: created },
        { id: TAGS.health, name: "Health", color: "#ef4444", createdAt: created },
        { id: TAGS.learning, name: "Learning", color: "#14b8a6", createdAt: created },
        { id: TAGS.side, name: "Side project", color: "#a855f7", createdAt: created },
        { id: TAGS.work, name: "Work", color: "#3b82f6", createdAt: created },
      ],
      tasks: [
        task("backlog", "Write the API docs", {
          descriptionDoc: doc(paragraph("Endpoints, auth flow and error codes.")),
          storyPoints: 3,
          day: day(2),
          dueDate: day(6),
          tagIds: [TAGS.work],
        }),
        task("backlog", "Plan next sprint", { day: day(1), dueDate: day(1), tagIds: [TAGS.work] }),
        task("backlog", "Read 'Designing Data-Intensive Applications' ch. 5", {
          descriptionDoc: doc(paragraph("Replication. Take notes for the blog post.")),
          dueDate: day(9),
          tagIds: [TAGS.learning],
        }),
        task("in_progress", "Payment provider integration", {
          descriptionDoc: doc(
            paragraph("Webhooks + retry queue. Test with sandbox keys first."),
            { type: "heading", attrs: { level: 3 }, content: [text("Steps")] },
            checklist(
              [true, "Create sandbox account"],
              [true, "Webhook endpoint with signature check"],
              [false, "Retry queue for failed events"],
              [false, "Switch to live keys"],
            ),
          ),
          storyPoints: 8,
          dueDate: day(2),
          tagIds: [TAGS.side],
        }),
        task("in_progress", "Fix flaky login test", { day: day(-1), dueDate: day(-1), tagIds: [TAGS.work] }),
        task("pending", "Research standing desk options", {
          descriptionDoc: doc(paragraph("Under 600 EUR, ships to Istanbul, electric.")),
          dueDate: day(5),
          tagIds: [TAGS.agent, TAGS.health],
          comments: [
            {
              author: "agent",
              body: "Found three electric desks under 600 EUR that ship to Istanbul; the comparison table is below.",
              createdAt: iso(0, 10),
            },
          ],
        }),
        task("pending", "Waiting for design review", {
          descriptionDoc: doc(paragraph("Shared the Figma link on Monday.")),
          storyPoints: 3,
          dueDate: day(4),
          tagIds: [TAGS.work, TAGS.side],
        }),
        task("pending", "Book a dentist appointment", { storyPoints: 1, day: day(1), dueDate: day(8), tagIds: [TAGS.health] }),
        task("done", "Morning news summary", {
          descriptionDoc: doc(paragraph("Summarize the five most important tech headlines of the day, with a link for each.")),
          storyPoints: 1,
          dueDate: day(0),
          tagIds: [TAGS.agent],
        }),
        task("done", "Ship onboarding emails", { storyPoints: 5, dueDate: day(0), tagIds: [TAGS.side] }),
        task("done", "30 min run", { storyPoints: 1, dueDate: day(0), tagIds: [TAGS.health] }),
        // Finished on earlier days: the Completed page.
        task("done", "Renew the domain", { day: day(-1), dueDate: day(-1), completedAt: iso(-1, 15), tagIds: [TAGS.side] }),
        task("done", "Quarterly tax filing", { storyPoints: 5, day: day(-1), dueDate: day(-1), completedAt: iso(-1, 12), tagIds: [TAGS.work] }),
        task("done", "Yoga class", { storyPoints: 1, day: day(-2), dueDate: day(-2), completedAt: iso(-2, 18), tagIds: [TAGS.health] }),
        task("done", "Finish the TypeScript course", { storyPoints: 3, day: day(-2), dueDate: day(-2), completedAt: iso(-2, 21), tagIds: [TAGS.learning] }),
      ],
      routines: [
        routine(1, "Back up the laptop", "External disk first, then the cloud copy.", { kind: "weekly", time: "20:00", days: [0] }),
        routine(
          2,
          "Morning news summary",
          "Summarize the five most important tech headlines of the day, with a link for each.",
          { kind: "daily", time: "07:30" },
          true,
        ),
        routine(3, "Pay the bills", "Rent, electricity, internet.", { kind: "cron", expression: "0 9 1 * *" }),
        routine(4, "Water the plants", "The fern needs more.", { kind: "weekly", time: "08:00", days: [1, 4] }),
        routine(5, "Weekly review", "- Clear the inbox\n- Check the Completed page\n- Plan next week", { kind: "weekly", time: "16:00", days: [5] }),
      ],
      agentSettings: { autoTagId: TAGS.agent },
    },
  };
}

// ---------------------------------------------------------------- server

async function waitForServer(url, child) {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode != null) throw new Error("The dev server exited early.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The dev server did not answer at ${url}.`);
}

/** A fake browser subscription (no push service is ever called for screenshots). */
function demoSubscription(name) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/demo-${name}`,
    expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}

/**
 * The Settings page with notifications on for "this device" and a phone. The
 * browser's PushManager is stubbed: headless Chromium can't reach a real push
 * service, and nothing is sent anyway.
 */
async function openWithPush(light, cookies) {
  const ctx = await light.browser().newContext({
    viewport: { width: 1712, height: 980 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: TZ,
  });
  await ctx.addCookies(cookies);
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  await ctx.addInitScript((subscription) => {
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
    if (typeof PushManager === "undefined") return;
    const make = (key) => ({
      endpoint: subscription.endpoint,
      options: { applicationServerKey: key, userVisibleOnly: true },
      toJSON: () => subscription,
      unsubscribe: async () => true,
    });
    // Kept across reloads of the tab, like a real subscription.
    PushManager.prototype.subscribe = async (options) => {
      sessionStorage.setItem("demoPushKey", JSON.stringify([...new Uint8Array(options.applicationServerKey)]));
      return make(options.applicationServerKey);
    };
    PushManager.prototype.getSubscription = async () => {
      const saved = sessionStorage.getItem("demoPushKey");
      return saved ? make(new Uint8Array(JSON.parse(saved)).buffer) : null;
    };
  }, demoSubscription("desktop"));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/en/settings`);
  await p.getByRole("button", { name: "Turn on for this device" }).click();
  await p.getByText("On for this device.").waitFor();
  const { data } = await (await p.request.get(`${BASE}/api/push`)).json();
  await p.request.post(`${BASE}/api/push/subscription`, {
    data: JSON.stringify({ subscription: demoSubscription("phone"), publicKey: data.publicKey, locale: "en" }),
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      "User-Agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    },
  });
  await p.reload();
  await p.getByText("On for this device.").waitFor();
  await p.waitForLoadState("networkidle");
  return p;
}

async function main() {
  const { chromium } = loadPlaywright();
  const dataDir = await mkdtemp(path.join(tmpdir(), "task-panel-shots-"));
  const server = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGLITE_DIR: path.join(dataDir, "pglite"),
      SETUP_TOKEN: SETUP_CODE,
      APP_TIMEZONE: TZ,
      // No Gateway: the board and the agent tag still look the same.
      OPENCLAW_GATEWAY_TOKEN: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  process.on("exit", stop);

  // The full Chromium build: the headless shell always reports notifications as
  // blocked, which the Settings screenshot can't use.
  const browser = await chromium.launch({ channel: "chromium" }).catch(() => chromium.launch());
  try {
    await waitForServer(`${BASE}/api/health`, server);
    const shots = [];
    const shot = (name, run) => {
      if (name.includes(only)) shots.push([name, run]);
    };

    const context = async (colorScheme) => {
      const ctx = await browser.newContext({
        viewport: { width: 1712, height: 860 },
        deviceScaleFactor: 1,
        colorScheme,
        locale: "en-US",
        timezoneId: TZ,
      });
      // Hide the Next.js dev overlay badge.
      await ctx.addInitScript(() => {
        addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          document.head.append(style);
        });
      });
      return ctx;
    };

    // Setup page, before the account exists.
    const light = await context("light");
    const page = await light.newPage();
    await page.goto(`${BASE}/en/register`);
    await page.waitForSelector('input[name="setupCode"]');
    if ("setup".includes(only)) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.focus('input[name="setupCode"]');
      await page.screenshot({ path: path.join(outDir, "setup.png") });
      await page.setViewportSize({ width: 1712, height: 860 });
    }

    await page.fill('input[name="setupCode"]', SETUP_CODE);
    await page.fill('input[name="name"]', "Owner");
    await page.fill('input[name="email"]', "owner@example.com");
    await page.fill('input[name="password"]', "demo-password-123");
    await page.fill('input[name="confirm"]', "demo-password-123");
    await Promise.all([page.waitForURL((url) => !url.pathname.includes("register")), page.click('button[type="submit"]')]);

    const restore = await page.request.post(`${BASE}/api/backup`, {
      data: JSON.stringify(demoBackup()),
      headers: { "Content-Type": "application/json", Origin: BASE },
    });
    if (!restore.ok()) throw new Error(`Restoring the demo data failed: ${restore.status()} ${await restore.text()}`);
    const cookies = await light.cookies();

    const open = async (scheme, pathname) => {
      const ctx = scheme === "light" ? light : await context(scheme);
      if (ctx !== light) await ctx.addCookies(cookies);
      const p = await ctx.newPage();
      await p.goto(`${BASE}${pathname}`);
      await p.waitForLoadState("networkidle");
      return p;
    };
    const save = (p, name) => p.screenshot({ path: path.join(outDir, `${name}.png`) });

    shot("board-light", async () => save(await open("light", "/en"), "board-light"));
    shot("board-dark", async () => save(await open("dark", "/en"), "board-dark"));
    shot("task-light", async () => {
      const p = await open("light", "/en");
      await p.getByText("Payment provider integration").first().click();
      await p.getByRole("dialog").waitFor();
      await p.waitForTimeout(500);
      await save(p, "task-light");
    });
    shot("completed-dark", async () => save(await open("dark", "/en/completed"), "completed-dark"));
    shot("routine-light", async () => {
      const p = await open("light", "/en");
      await p.getByRole("region", { name: "Routines" }).getByText("Morning news summary").click();
      await p.getByRole("dialog").waitFor();
      await p.waitForTimeout(300);
      await save(p, "routine-light");
    });
    shot("routine-schedule-light", async () => {
      const p = await open("light", "/en");
      await p.getByRole("region", { name: "Routines" }).getByText("Morning news summary").click();
      const dialog = p.getByRole("dialog");
      await dialog.getByRole("button", { name: "Edit" }).click();
      await p.waitForTimeout(300);
      await save(p, "routine-schedule-light");
    });
    shot("settings-light", async () => {
      const p = await openWithPush(light, cookies);
      await save(p, "settings-light");
      await p
        .getByRole("region", { name: "Notifications" })
        .screenshot({ path: path.join(outDir, "notifications-light.png") });
    });
    // The backup button while the server builds the file (held here so the
    // spinner stays up), then right after the file was saved.
    shot("backup-download-light", async () => {
      const p = await open("light", "/en/settings");
      let release;
      const held = new Promise((resolve) => (release = resolve));
      await p.route("**/api/backup", async (route) => {
        await held;
        await route.continue();
      });
      const region = p.getByRole("region", { name: "Backup" });
      await region.getByRole("button", { name: "Download backup" }).click();
      await region.locator('[data-phase="preparing"]').waitFor();
      await p.waitForTimeout(300);
      await region.screenshot({ path: path.join(outDir, "backup-download-light.png") });
      release();
      await region.locator('[data-phase="done"]').waitFor();
    });
    shot("backup-download-dark", async () => {
      const p = await open("dark", "/en/settings");
      const region = p.getByRole("region", { name: "Backup" });
      await region.getByRole("button", { name: "Download backup" }).click();
      await region.locator('[data-phase="done"]').waitFor();
      await region.screenshot({ path: path.join(outDir, "backup-download-dark.png") });
    });

    for (const [name, run] of shots) {
      await run();
      console.log(`[screenshots] ${name}.png`);
    }
  } finally {
    await browser.close();
    stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
