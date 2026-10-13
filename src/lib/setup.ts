import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema, type Db } from "./db";
import { hasUsers } from "./session";
import { generateSetupCode } from "./setup-code";

const { appSettings } = schema;
const KEY = "setup_code";

/** SETUP_TOKEN if set; otherwise a generated code kept in the database until the admin exists. */
export async function getOrCreateSetupCode(db: Db): Promise<string> {
  const fromEnv = process.env.SETUP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const read = async () =>
    (await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)))[0]?.value;
  const existing = await read();
  if (existing) return existing;
  // Concurrent first starts both insert; the conflict keeps whichever came first.
  await db.insert(appSettings).values({ key: KEY, value: generateSetupCode() }).onConflictDoNothing();
  return (await read())!;
}

export async function clearSetupCode(db: Db): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, KEY));
}

/**
 * Prints the setup code while no account exists. Only people with access to the
 * server logs (e.g. the Dokploy panel) can read it, which is the point.
 */
export async function logSetupCode(): Promise<void> {
  const db = await getDb();
  if (await hasUsers(db)) return;
  const line = "=".repeat(60);
  if (process.env.SETUP_TOKEN?.trim()) {
    console.log(`\n${line}\n Task Panel setup: no admin account yet.\n Open /register and enter the SETUP_TOKEN you configured.\n${line}\n`);
    return;
  }
  const code = await getOrCreateSetupCode(db);
  console.log(`\n${line}\n Task Panel setup: no admin account yet.\n Open /register and enter this setup code:\n\n     ${code}\n${line}\n`);
}
