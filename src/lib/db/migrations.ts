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
];
