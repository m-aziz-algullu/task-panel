// Helpers for route handlers that take POSTs from the app's own pages.

/**
 * The session cookie is SameSite=Lax, so another site can't POST with it; this
 * same-origin check is the second lock, the one Server Actions have built in.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The body as text, or null once it passes `maxBytes`; never buffers more than that. */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}
