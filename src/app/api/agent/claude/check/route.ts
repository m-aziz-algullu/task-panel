import { checkClaude, type ClaudeCheckResult } from "@/lib/agent/claude-health";
import { getClaudeStatus } from "@/lib/agent/claude-status";
import { getDb } from "@/lib/db";
import { sameOrigin } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";

/**
 * Checks the Claude sign-in with one tiny real turn and answers with the new status.
 * A route handler, not a Server Action: the turn can take a minute, and Server
 * Actions run one at a time.
 */
export async function POST(request: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  // OpenClaw re-reads its credentials first; nothing to test while no sign-in is set up.
  const before = await getClaudeStatus({ refresh: true });
  let check: ClaudeCheckResult | null = null;
  if (before.gateway.state !== "disabled" && (before.auth.state === "connected" || before.auth.state === "expired")) {
    check = await checkClaude(await getDb());
  }
  const status = check ? await getClaudeStatus() : before;
  return Response.json(
    { status, error: check?.outcome === "error" ? check.error : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
