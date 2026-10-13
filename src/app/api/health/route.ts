import { connection } from "next/server";

// Liveness probe for Docker / Dokploy. Doesn't touch the database on purpose,
// so a slow database never gets the container restarted.
export async function GET() {
  await connection();
  return Response.json({ ok: true });
}
