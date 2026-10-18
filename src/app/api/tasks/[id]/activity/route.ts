import type { NextRequest } from "next/server";
import { latestRun } from "@/lib/agent/runs";
import { getDb } from "@/lib/db";
import { listComments } from "@/lib/data";
import { getCurrentUser } from "@/lib/session";

// A task's comments and its latest agent run. A route handler rather than a
// Server Action: the task dialog polls this while a run is active, and Server
// Actions run one at a time, so polling would hold up saves.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/activity">) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const taskId = Number((await ctx.params).id);
  if (!Number.isInteger(taskId) || taskId <= 0) return Response.json({ error: "invalid" }, { status: 400 });
  const db = await getDb();
  const [comments, run] = await Promise.all([listComments(db, taskId), latestRun(db, taskId)]);
  return Response.json({ comments, run }, { headers: { "Cache-Control": "no-store" } });
}
