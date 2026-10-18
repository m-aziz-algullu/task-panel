import type { NextRequest } from "next/server";
import type { MessageKey } from "@/i18n/translate";

export function chatError(error: MessageKey, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Requests that change something come from the panel itself (the cookie is SameSite=Lax too). */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
}
