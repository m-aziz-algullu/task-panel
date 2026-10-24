# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Task Panel is a self-hosted, single-user kanban board (Next.js 16 App Router, React 19, Drizzle on PostgreSQL, Tailwind 4) with an optional bundled OpenClaw agent that works on tasks. Requires Node.js 24+.

## Commands

```bash
npm run dev            # dev server on :3000; uses embedded PGlite in ./.data/pglite when DATABASE_URL is unset
npm run agent:dev      # (second terminal, optional) local OpenClaw Gateway on 127.0.0.1:18799, home in ./.data/openclaw
npm run agent:cli -- … # run the openclaw CLI against that local gateway
npm run lint
npm run typecheck      # next typegen && tsc --noEmit
npm test               # vitest run (tests/**/*.test.ts)
npx vitest run tests/dates.test.ts        # one file
npx vitest run -t "name of the test"      # one test by name
npm run build
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build in that order.

On a fresh database the server prints a one-time setup code to the logs; `/register` needs it to create the only (admin) account. `SETUP_TOKEN` pins it. `.env.example` lists every env var.

`README.md` and `README.tr.md` are translations of each other; change both together.

## Architecture

**Routing and i18n.** Every page lives under `src/app/[lang]/` (`en`, `tr`). `src/proxy.ts` (Next 16's replacement for middleware) adds the locale prefix to bare paths and does an optimistic cookie-only auth redirect; the real session check happens against the DB in every data read and Server Action via `requireSession()` (`src/lib/session.ts`). Server Components get strings from `getI18n()` (`src/i18n/server.ts`, uses `next/root-params`, so it fails in Client Components); Client Components use the `I18nProvider` context from `src/i18n/client.tsx`. `dictionaries/tr.ts` defines the `Dictionary` type, so every new key must be added to both `tr.ts` and `en.ts`. Imports use the `@/` alias for `src/` (tsconfig and vitest).

**Auth.** Login and register actions live in `src/app/[lang]/(auth)/actions.ts`. Attempts are rate limited per IP in the `auth_attempts` table (`rate-limit.ts`, pure rules in `rate-limit-rules.ts`); an attempt is recorded before it is checked, and blocked attempts are refused before any password or code is compared.

**Data layer.** `getDb()` (`src/lib/db/index.ts`) is a global, lazily created connection that applies migrations on first use: `postgres` when `DATABASE_URL` is set, PGlite otherwise (dev only; production refuses to start without `DATABASE_URL`). Migrations are raw SQL in `src/lib/db/migrations.ts`, applied in order under an advisory lock. Never edit a shipped entry; append a new version and keep `schema.ts` in sync by hand (there is no drizzle-kit). Reads are in `src/lib/data.ts`; all panel mutations are Server Actions in `src/app/actions.ts` (zod-validated, end with `refresh()`). Server Actions run one at a time, so anything that polls (e.g. `api/tasks/[id]/activity`, which the task dialog polls while a run is active) is a route handler instead; route handlers check the session with `getCurrentUser()`. `api/health` is the unauthenticated liveness probe and deliberately never touches the DB. `cacheComponents` is on, so DB reads call `connection()` first and use the DB clock (`sql\`now()\``) instead of `new Date()` where prerendering could happen.

**Days and ordering.** A "day" is computed in `APP_TIMEZONE` (`getClock()` in `data.ts`, helpers in `dates.ts`). Done tasks stay on the board until midnight, then appear on `/completed`; open tabs refresh themselves at the rollover (`use-day-rollover.ts`). Card order is a float `position` per column (`task-status.ts`, `ordering.ts`).

**Routines.** Recurring chores in their own `routines` table (title + markdown body), shown as a last, non-draggable column on the board (`src/components/routines.tsx`). They are not tasks: no status, position or tags.

**Rich text.** Task descriptions are TipTap documents (`src/lib/rich-text/`, editor in `src/components/rich-text/`). `document.ts` validates every save on the server against the schema from `extensions.ts`, the palette in `marks.ts` and `isAllowedHref`, so a new extension, mark or color must be added there too or saves will reject it.

**Startup.** `src/instrumentation-node.ts` connects to the DB, prints the setup code, and if the agent is enabled warms the Gateway connection and starts the agent worker.

**Agent (OpenClaw).** `src/lib/openclaw/` connects to the Gateway (token from env or `.data/secrets` in dev). `src/lib/agent/`:
- `runs.ts`: `agent_runs` rows act as a DB-backed queue (enqueue / claim / finalize).
- `worker.ts`: an in-process polling loop that claims queued runs, sends prompts (`prompt.ts`), waits on the Gateway, enforces token and time limits, posts results as task comments, and moves the task's status.
- `auto.ts`: adding the agent tag to a task enqueues a run.
- `continue.ts` / `continuation.ts`: a user comment on an agent task continues the same OpenClaw session unless it has grown too big.
- `chat.ts` plus `src/app/api/agent/chat/`: the floating chat window, separate from task runs.
- `settings.ts` / `settings-shape.ts`: agent settings, stored as JSON under one key in `app_settings`; edited on the `/agent` page.
- `claude-auth.ts` / `claude-status.ts` plus `api/agent/claude`: how OpenClaw reaches Claude (subscription or API key), as shown in the UI; Task Panel never sees the credentials. `api/agent/options` serves what the run panel offers: the Gateway's agents and configured models, plus the defaults.

Files named `*-shape.ts` (and other modules without `import "server-only"`) are pure and safe for Client Components and tests. Tests only import those, plus `docker/openclaw-bootstrap.mjs` and `docker/control-ui-proxy.mjs`.

**Docker.** The default image runs `docker/supervisor.mjs`, which starts the OpenClaw Gateway (loopback only, as user `node`, home on `/data`) and the Next standalone server (as `nextjs`) in one container. `docker/openclaw-bootstrap.mjs` rewrites the Gateway's managed config on every start (allowed tools, bundled skills, context limits, web search provider), and the app's env never reaches the Gateway. On a start-first redeploy (Dokploy) the old container's Gateway still owns `/data` and OpenClaw refuses config writes until it stops, so the supervisor starts the app first and retries the config write in the background before starting the Gateway; keep the OpenClaw CLI calls async, since the proxy shares that process. With the agent on, the public port belongs to `docker/control-ui-proxy.mjs`: it passes everything to Next (moved to 127.0.0.1:3001, headers untouched) except `/openclaw`, `/__openclaw__` and every WebSocket, which go to the Gateway's Control UI once `/api/agent/control-ui/session` confirms the session; to the Gateway those requests look local (forwarded headers stripped, Host/Origin rewritten), so the proxy's session and same-origin checks are the only gate. `/api/agent/control-ui` hands the token over in a `#token=` fragment. `docker build --target plain .` builds the image without the agent; `TASKPANEL_AGENT=off` disables it at runtime. `next.config.ts` keeps PGlite and the OpenClaw/`ws` packages unbundled and traced in whole; keep that when adding similar runtime-resolved deps.
