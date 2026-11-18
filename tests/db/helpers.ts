// Shared by the DB-backed tests. Each test file gets its own in-memory PGlite
// database (PGLITE_DIR=memory://, set by the file before anything connects), with
// every migration applied, exactly as the app's getDb() builds it.
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";

export const TABLES = [
  "task_tags",
  "task_comments",
  "agent_runs",
  "tasks",
  "tags",
  "routines",
  "sessions",
  "users",
  "app_settings",
  "auth_attempts",
] as const;

export async function testDb(): Promise<Db> {
  return getDb();
}

/** Empties every table (migrations stay applied) so tests don't see each other's rows. */
export async function resetDb(): Promise<Db> {
  const db = await getDb();
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  return db;
}

export function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

/** A plain one-paragraph TipTap document. */
export function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
