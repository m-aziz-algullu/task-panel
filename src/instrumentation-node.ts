import { MISSING_DATABASE_URL, getDb } from "@/lib/db";
import { logSetupCode } from "@/lib/setup";

// Runs once when the server starts (not during `next build`).
if (process.env.NEXT_PHASE !== "phase-production-build") {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    // Refuse to start rather than run without a persistent database.
    console.error(`[db] ${MISSING_DATABASE_URL}`);
    process.exit(1);
  }

  // Connect and apply migrations up front so a wrong DATABASE_URL shows up in
  // the logs right away. Requests retry on their own if this fails.
  getDb()
    .then(() => console.log("[db] Connected, migrations up to date."))
    .then(logSetupCode)
    .then(async () => {
      // The bundled OpenClaw agent: connect to the Gateway and start running queued tasks.
      const { agentEnabled } = await import("@/lib/openclaw/connection");
      if (!agentEnabled()) return;
      const { warmGateway } = await import("@/lib/openclaw/client");
      const { startAgentWorker } = await import("@/lib/agent/worker");
      warmGateway();
      startAgentWorker();
      console.log("[agent] OpenClaw Gateway configured; agent worker started.");
    })
    .catch((error) => console.error("[db] Could not connect to the database:", error));
}
