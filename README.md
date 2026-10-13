# Task Panel

[![CI](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [Türkçe](README.tr.md)

A self-hosted, single-user kanban board for your own tasks. Tags with your own colors, story points, a day on every task, and finished tasks that leave the board at midnight and land in a day-by-day archive.

![Board](docs/screenshots/board-light.png)

| Dark mode | Task details | Completed, grouped by day |
| --- | --- | --- |
| ![Board in dark mode](docs/screenshots/board-dark.png) | ![Task dialog](docs/screenshots/task-light.png) | ![Completed tasks](docs/screenshots/completed-dark.png) |

## Features

- **Board** with four fixed columns: Backlog, In Progress, Pending, Done. Drag and drop between and within columns (mouse, touch and keyboard).
- **Tasks** have a title, description, day, story points (1, 2, 3, 5, 8, 13, 21) and tags. Cards show tags, the day, `#id` and points; open tasks past their day are highlighted.
- **Rich text descriptions** (Jira-style): headings, bold/italic/underline/strike, text colors and highlights, bullet/numbered lists, checklists, quotes, code, links, tables and dividers. Markdown shortcuts (`# `, `- `, `[ ] `, `**bold**`…), a `/` quick-insert menu, `Ctrl+K` for links and `Ctrl`+click to open them.
- **Tags** with a name and any color; filter the board by tag or search text.
- **End of day:** tasks moved to Done stay on the board until midnight (in `APP_TIMEZONE`), then move to the **Completed** page, which lists them by day at full card size. An open tab refreshes itself at midnight.
- **English and Turkish** UI, picked from the browser language and switchable in the header.
- Light and dark mode.
- Keyboard shortcuts: `N` new task, `/` search, `Ctrl+Enter` save, `Esc` close.
- **Single admin account, protected setup** (see below).

## How sign-up works

There's exactly one account. On a fresh install the app has no users and:

1. On startup, the server prints a one-time **setup code** to its logs:
   ```
   ============================================================
    Task Panel setup: no admin account yet.
    Open /register and enter this setup code:

        K7PQ-3XMA-9WRT-H2CD
   ============================================================
   ```
2. Opening the app takes you to the **Setup** page, which asks for that code plus your name, email and password.
3. Once the admin account exists, the setup page and the sign-up action are closed for good. Only sign-in remains.

Only someone who can read the server logs can create the account, so a stranger who finds your URL before you do can't take it over. To pick the code yourself, set `SETUP_TOKEN`.

**Brute-force protection:** sign-in allows 10 failed attempts per IP and 50 per account within 15 minutes, then refuses further attempts (without checking the password) until the window passes. Setup codes are limited per IP the same way. Responses also send `Strict-Transport-Security`, so browsers stick to HTTPS once they've seen your domain over it.

<img src="docs/screenshots/setup.png" alt="Setup page" width="420">

## Quick start (local development)

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and use the setup code printed in the terminal. Without `DATABASE_URL`, development uses an embedded PostgreSQL ([PGlite](https://pglite.dev)) stored in `./.data/pglite`, so there's nothing else to install. To use a real Postgres, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

```bash
npm run lint
npm run typecheck
npm test
```

## Self-hosting

Production runs on **PostgreSQL only**: the server refuses to start without `DATABASE_URL`. Tables are created and migrated automatically on startup.

### Docker Compose

```bash
POSTGRES_PASSWORD=choose-a-password docker compose up -d
docker compose logs app   # the setup code is here
```

Then open http://localhost:3000.

### Dokploy

1. **Database:** *Create Service → Database → PostgreSQL*, deploy it, and copy its **Internal Connection URL**.
2. **App:** *Create Service → Application*, connect this repository, **Build Type: Dockerfile**.
3. **Environment:**
   ```
   DATABASE_URL=<internal connection URL from step 1>
   APP_TIMEZONE=Europe/Istanbul
   ```
4. **Domain:** add one with **container port 3000** and HTTPS.
5. **Deploy**, open **Logs**, copy the setup code, and open your domain to create the admin account.

**Backups:** your data lives in the Postgres volume on the server. In Dokploy, add an S3 destination (AWS S3, Cloudflare R2, Backblaze B2, …) under *Settings → S3 Destinations*, then schedule backups in the database's **Backups** tab, e.g. daily at `0 3 * * *`.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | In production | PostgreSQL connection string. |
| `APP_TIMEZONE` | No | IANA time zone that decides when a day ends. Default `Europe/Istanbul`. |
| `SETUP_TOKEN` | No | Your own setup code. If unset, one is generated and printed in the logs. |
| `DATABASE_POOL_SIZE` | No | Max Postgres connections. Default `5`. |
| `PGLITE_DIR` | No | Development only: where the embedded database is stored. |

Health check: `GET /api/health`.

## Tech stack

Next.js 16 (App Router, Cache Components, Server Actions), React 19, Tailwind CSS 4, Drizzle ORM, PostgreSQL, dnd-kit. Passwords are hashed with scrypt; sessions are random tokens stored as SHA-256 hashes.

## Project structure

```
src/app/[lang]/(panel)/        Board and Completed pages
src/app/[lang]/(auth)/         Setup (first admin), sign-in, sign-out
src/app/actions.ts             Server Actions for tasks, tags and moves
src/app/api/health/            Health check
src/proxy.ts                   Locale redirects and session-cookie gate
src/i18n/                      Dictionaries (en, tr) and helpers
src/lib/db/                    Connection, schema, migrations
src/lib/session.ts             Session checks against the database
src/lib/auth.ts                Password hashing, session tokens
src/lib/setup*.ts              One-time setup code
src/lib/rate-limit*.ts         Sign-in attempt limits
src/lib/dates.ts               Time-zone-aware day math
src/components/                UI
```

Schema changes go in `src/lib/db/migrations.ts` as a new version; shipped versions are never edited.

## License

[MIT](LICENSE)
