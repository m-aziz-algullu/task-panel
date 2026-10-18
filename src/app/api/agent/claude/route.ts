import type { NextRequest } from "next/server";
import { getClaudeStatus } from "@/lib/agent/claude-status";
import { getCurrentUser } from "@/lib/session";

// Whether the bundled agent can reach Claude; `?refresh=1` makes OpenClaw re-check.
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  return Response.json(await getClaudeStatus({ refresh }), { headers: { "Cache-Control": "no-store" } });
}
