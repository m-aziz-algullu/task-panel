import "server-only";

import { and, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { agentEnabled } from "../openclaw/connection";
import type { AgentRunInput } from "../types";
import { enqueueRun, finalizeRun } from "./runs";
import { getAgentSettings } from "./settings";
import type { AgentSettings } from "./settings-shape";
import { systemCommentBody } from "./system-comments";
import { pokeAgentWorker } from "./worker";

const { agentRuns } = schema;

/** A run with the settings page's defaults, as the agent tag starts it. */
export function defaultRunInput(settings: AgentSettings): AgentRunInput {
  return {
    agentId: settings.agentId,
    model: settings.model,
    thinking: settings.thinking,
    timeoutSeconds: settings.timeoutSeconds,
    tokenLimit: settings.tokenPresets[settings.defaultPreset],
    limitMode: settings.limitMode,
  };
}

/**
 * The agent tag: adding it to an open task queues a run with the defaults;
 * removing it again cancels that run while it is still waiting in the queue.
 */
export async function syncAgentTag(
  db: Db,
  task: { id: number; status: string },
  before: number[],
  after: number[],
): Promise<void> {
  if (!agentEnabled()) return;
  const settings = await getAgentSettings(db);
  const tagId = settings.autoTagId;
  if (tagId == null) return;
  const had = before.includes(tagId);
  const has = after.includes(tagId);
  if (!had && has && task.status !== "done") {
    if (await enqueueRun(db, task.id, defaultRunInput(settings), "tag")) pokeAgentWorker();
  } else if (had && !has) {
    const [queued] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.taskId, task.id), eq(agentRuns.status, "queued"), eq(agentRuns.trigger, "tag")));
    if (queued) {
      await finalizeRun(db, queued, {
        status: "aborted",
        comment: { author: "system", body: systemCommentBody("agentRun.systemAborted") },
      });
    }
  }
}
