import "server-only";

import { getDb, type Db } from "../db";
import { fromInsideContainer } from "./loopback";
import { runForToken, type RunRow } from "./runs";

/**
 * Resolves the run behind an agent API request's bearer token. The token is the
 * one written into that run's prompt; it stops working the moment the run ends.
 */
export async function agentRequest(
  request: Request,
): Promise<{ ok: true; db: Db; run: RunRow } | { ok: false; response: Response }> {
  if (!fromInsideContainer(request)) return { ok: false, response: agentError(404, "Not found.") };
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return { ok: false, response: agentError(401, "Missing bearer token.") };
  const db = await getDb();
  const run = await runForToken(db, token);
  if (!run) return { ok: false, response: agentError(401, "Unknown token, or this run has already ended.") };
  return { ok: true, db, run };
}

export function agentError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
