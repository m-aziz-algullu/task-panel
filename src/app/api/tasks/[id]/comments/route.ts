import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { listComments } from "@/lib/data";
import { getCurrentUser } from "@/lib/session";

// A route handler rather than a Server Action: the task dialog loads this when it
// opens, and Server Actions run one at a time, so a read would hold up saves.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/comments">) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const taskId = Number((await ctx.params).id);
  if (!Number.isInteger(taskId) || taskId <= 0) return Response.json({ error: "invalid" }, { status: 400 });
  const comments = await listComments(await getDb(), taskId);
  return Response.json({ comments }, { headers: { "Cache-Control": "no-store" } });
}
