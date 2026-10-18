import "server-only";

import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { parseAgentSettings, type AgentSettings } from "./settings-shape";

const { appSettings } = schema;
const KEY = "agent.settings";

export async function getAgentSettings(db: Db): Promise<AgentSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  if (!row) return parseAgentSettings({});
  try {
    return parseAgentSettings(JSON.parse(row.value));
  } catch {
    return parseAgentSettings({});
  }
}

export async function saveAgentSettings(db: Db, settings: AgentSettings): Promise<void> {
  const value = JSON.stringify(settings);
  await db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
