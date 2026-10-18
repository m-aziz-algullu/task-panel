import { z } from "zod";
import { agentError, agentRequest, readJson } from "@/lib/agent/api";
import { addRunComment } from "@/lib/agent/runs";
import { MAX_COMMENT_LENGTH } from "@/lib/types";

const input = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH) });

// A progress note from the agent while it works.
export async function POST(request: Request) {
  const auth = await agentRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return agentError(400, `Send {"body": "..."} with 1 to ${MAX_COMMENT_LENGTH} characters.`);
  await addRunComment(auth.db, auth.run, "agent", parsed.data.body);
  return Response.json({ ok: true });
}
