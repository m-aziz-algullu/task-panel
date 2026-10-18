import { inArray } from "drizzle-orm";
import { agentRequest } from "@/lib/agent/api";
import { parseSystemComment } from "@/lib/agent/system-comments";
import { schema } from "@/lib/db";
import { listComments, loadTask } from "@/lib/data";

// The agent's view of its task: details, comments so far and its budget.
export async function GET(request: Request) {
  const auth = await agentRequest(request);
  if (!auth.ok) return auth.response;
  const { db, run } = auth;
  const task = await loadTask(db, run.taskId);
  if (!task) return Response.json({ ok: false, error: "Task not found." }, { status: 404 });
  const [comments, tagRows] = await Promise.all([
    listComments(db, task.id),
    task.tagIds.length
      ? db.select({ name: schema.tags.name }).from(schema.tags).where(inArray(schema.tags.id, task.tagIds))
      : Promise.resolve([]),
  ]);
  return Response.json(
    {
      ok: true,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        day: task.day,
        storyPoints: task.storyPoints,
        tags: tagRows.map((tag) => tag.name),
      },
      comments: comments.map((comment) => ({
        author: comment.author,
        // System comments are stored as message keys; the agent gets the key and values.
        body: (comment.author === "system" && parseSystemComment(comment.body)) || comment.body,
        createdAt: comment.createdAt,
      })),
      budget: { tokenLimit: run.tokenLimit, tokensUsed: run.tokensUsed, limitMode: run.limitMode },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
