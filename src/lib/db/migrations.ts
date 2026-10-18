// Ordered schema migrations, applied once each on startup. Never edit a shipped
// entry; append a new one instead.

export const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE tags (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        color text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE tasks (
        id serial PRIMARY KEY,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('backlog', 'in_progress', 'pending', 'done')),
        story_points integer,
        day date NOT NULL,
        position double precision NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )`,
      `CREATE INDEX tasks_status_idx ON tasks (status, position)`,
      `CREATE INDEX tasks_completed_at_idx ON tasks (completed_at)`,
      `CREATE TABLE task_tags (
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        tag_id integer NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      )`,
      `CREATE INDEX task_tags_tag_idx ON task_tags (tag_id)`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'admin',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      // id is the SHA-256 of the cookie token, so a leaked table can't be replayed.
      `CREATE TABLE sessions (
        id text PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX sessions_user_idx ON sessions (user_id)`,
    ],
  },
  {
    version: 3,
    statements: [
      // Small key/value store; holds the one-time setup code until the admin exists.
      `CREATE TABLE app_settings (
        key text PRIMARY KEY,
        value text NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      // Failed (and in-flight) sign-in attempts per IP / account, for rate limiting.
      `CREATE TABLE auth_attempts (
        id serial PRIMARY KEY,
        key text NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX auth_attempts_key_at_idx ON auth_attempts (key, at)`,
      `CREATE INDEX auth_attempts_at_idx ON auth_attempts (at)`,
    ],
  },
  {
    version: 5,
    statements: [
      // Rich text description (editor JSON). tasks.description keeps its plain text for previews and search.
      `ALTER TABLE tasks ADD COLUMN description_doc jsonb`,
    ],
  },
  {
    version: 6,
    statements: [
      // Comments on a task, from the user or (later) the agent and the app itself.
      `CREATE TABLE task_comments (
        id serial PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        author text NOT NULL CHECK (author IN ('user', 'agent', 'system')),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at)`,
    ],
  },
  {
    version: 7,
    statements: [
      // One agent run per row: what was asked (model, budget…) and how it ended.
      `CREATE TABLE agent_runs (
        id serial PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'blocked', 'failed', 'timed_out', 'budget_exceeded', 'aborted')),
        trigger text NOT NULL CHECK (trigger IN ('manual', 'tag')),
        agent_id text,
        model text,
        thinking text,
        timeout_seconds integer NOT NULL,
        token_limit integer NOT NULL,
        limit_mode text NOT NULL CHECK (limit_mode IN ('soft', 'hard')),
        session_key text NOT NULL UNIQUE,
        openclaw_run_id text,
        token_hash text UNIQUE,
        tokens_used integer NOT NULL DEFAULT 0,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      )`,
      // At most one queued or running run per task.
      `CREATE UNIQUE INDEX agent_runs_active_task_idx ON agent_runs (task_id) WHERE status IN ('queued', 'running')`,
      `CREATE INDEX agent_runs_status_idx ON agent_runs (status, created_at)`,
      `ALTER TABLE task_comments ADD COLUMN run_id integer REFERENCES agent_runs (id) ON DELETE SET NULL`,
    ],
  },
  {
    version: 8,
    statements: [
      // Runs no longer hand the agent an API token: its final message is the report.
      `ALTER TABLE agent_runs DROP COLUMN token_hash`,
    ],
  },
  {
    version: 9,
    statements: [
      // A task's follow-up runs continue the same OpenClaw session, so the key repeats.
      `ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_session_key_key`,
      `CREATE INDEX agent_runs_session_key_idx ON agent_runs (session_key)`,
      `ALTER TABLE agent_runs ADD COLUMN continues_run_id integer REFERENCES agent_runs (id) ON DELETE SET NULL`,
      // The session's token total when the run started; the run spent the difference.
      `ALTER TABLE agent_runs ADD COLUMN usage_baseline integer NOT NULL DEFAULT 0`,
      `ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_trigger_check`,
      `ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_trigger_check CHECK (trigger IN ('manual', 'tag', 'comment'))`,
    ],
  },
];
