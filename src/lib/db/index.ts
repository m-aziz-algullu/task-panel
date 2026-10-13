import "server-only";

import { sql } from "drizzle-orm";
import { integer, pgTable, timestamp, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import { MIGRATIONS } from "./migrations";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const schemaMigrations = pgTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const MISSING_DATABASE_URL =
  "DATABASE_URL is not set. Production runs on PostgreSQL only; set DATABASE_URL to the database's connection string.";

/**
 * PostgreSQL via DATABASE_URL. Only in development, when DATABASE_URL is unset,
 * an embedded PGlite database in ./.data/pglite stands in so no setup is needed.
 */
async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const max = Number(process.env.DATABASE_POOL_SIZE) || 5;
    const client = postgres(url, { max, onnotice: () => {} });
    return drizzle(client, { schema }) as unknown as Db;
  }

  if (process.env.NODE_ENV === "production") throw new Error(MISSING_DATABASE_URL);

  const { mkdir } = await import("node:fs/promises");
  const dir = process.env.PGLITE_DIR || "./.data/pglite";
  // PGlite only creates the last path segment itself.
  await mkdir(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  return drizzle(await PGlite.create(dir), { schema }) as unknown as Db;
}

async function migrate(db: Db): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const migration of MIGRATIONS) {
    await db.transaction(async (tx) => {
      // Serializes concurrent starts (e.g. two replicas) on the same database.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(727274)`);
      const applied = await tx
        .select({ version: schemaMigrations.version })
        .from(schemaMigrations)
        .where(sql`${schemaMigrations.version} = ${migration.version}`);
      if (applied.length > 0) return;
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.insert(schemaMigrations).values({ version: migration.version });
    });
  }
}

const globalForDb = globalThis as unknown as { taskPanelDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.taskPanelDb) {
    globalForDb.taskPanelDb = connect()
      .then(async (db) => {
        await migrate(db);
        return db;
      })
      .catch((error) => {
        // Let the next request retry instead of caching the failure forever.
        globalForDb.taskPanelDb = undefined;
        throw error;
      });
  }
  return globalForDb.taskPanelDb;
}

export { schema };
