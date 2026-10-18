import { z } from "zod";
import { agentError, agentRequest, readJson } from "@/lib/agent/api";
import { finalizeRun } from "@/lib/agent/runs";
import { getAgentSettings } from "@/lib/agent/settings";
import { MAX_COMMENT_LENGTH } from "@/lib/types";

const input = z.object({
  outcome: z.enum(["done", "blocked"]),
  summary: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});

// The agent's closing report: becomes its final comment, ends the run and moves the task.
export async function POST(request: Request) {
  const auth = await agentRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) {
    return agentError(400, `Send {"outcome": "done" | "blocked", "summary": "..."} (summary up to ${MAX_COMMENT_LENGTH} characters).`);
  }
  const { db, run } = auth;
  const settings = await getAgentSettings(db);
  const { outcome, summary } = parsed.data;
  const ended = await finalizeRun(db, run, {
    status: outcome,
    comment: { author: "agent", body: summary },
    moveTo: outcome === "done" ? settings.statusOnDone : settings.statusOnBlocked,
  });
  if (!ended) return agentError(409, "This run has already ended.");
  return Response.json({ ok: true });
}
