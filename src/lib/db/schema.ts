import type { JSONContent } from "@tiptap/core";
import type { PushPayload } from "../push/shape";
import type { RoutineSchedule } from "../routine-schedule";
import { boolean, date, doublePrecision, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

// Mirrors the SQL in ./migrations.ts, which is what actually creates the tables.

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  /** Plain text of the description, derived on save; used for card previews and search. */
  description: text("description").notNull().default(""),
  descriptionDoc: jsonb("description_doc").$type<JSONContent>(),
  status: text("status").notNull(),
  storyPoints: integer("story_points"),
  day: date("day", { mode: "string" }).notNull(),
  /** Deadline; the card lights up as it nears while the task is open. */
  dueDate: date("due_date", { mode: "string" }).notNull(),
  position: doublePrecision("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
);

export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  author: text("author").notNull(),
  body: text("body").notNull(),
  runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  trigger: text("trigger").notNull(),
  agentId: text("agent_id"),
  model: text("model"),
  thinking: text("thinking"),
  timeoutSeconds: integer("timeout_seconds").notNull(),
  tokenLimit: integer("token_limit").notNull(),
  limitMode: text("limit_mode").notNull(),
  sessionKey: text("session_key").notNull(),
  openclawRunId: text("openclaw_run_id"),
  /** The run whose OpenClaw conversation this one carries on, if any. */
  continuesRunId: integer("continues_run_id"),
  /** The session's token total when this run started. */
  usageBaseline: integer("usage_baseline").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const routines = pgTable("routines", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  /** Markdown notes: the steps, links, when it's due. */
  body: text("body").notNull().default(""),
  /** RoutineSchedule as JSON; null for a routine that's only notes. */
  schedule: jsonb("schedule").$type<RoutineSchedule>(),
  handToAgent: boolean("hand_to_agent").notNull().default(false),
  /** When the scheduler creates the next task; null without a schedule. */
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const authAttempts = pgTable("auth_attempts", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  /** The application server key the browser subscribed with. */
  vapidPublicKey: text("vapid_public_key").notNull(),
  /** Language the notifications are written in: the UI's when the browser subscribed. */
  locale: text("locale").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const pushDeliveries = pgTable("push_deliveries", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id")
    .notNull()
    .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  /** PushPayload as JSON; encrypted for the browser on every attempt. */
  payload: jsonb("payload").$type<PushPayload>().notNull(),
  /** Push service Topic header: a newer message with the same topic replaces an undelivered one. */
  topic: text("topic"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  /** Past this the notification is stale and dropped instead of sent. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
