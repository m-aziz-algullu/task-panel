import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentPage } from "@/components/agent-page";
import { getI18n } from "@/i18n/server";
import { getClaudeStatus } from "@/lib/agent/claude-status";
import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.agent") };
}

async function AgentData() {
  await connection();
  await requireSession();
  const status = await getClaudeStatus();
  return (
    <AgentPage
      initial={status}
      // Production runs in the Docker image; development next to `npm run agent:dev`.
      container={process.env.NODE_ENV === "production"}
      ephemeral={process.env.TASKPANEL_DATA_EPHEMERAL === "1"}
    />
  );
}

export default function AgentRoute() {
  return (
    <Suspense fallback={<div className="mx-auto h-64 w-full max-w-3xl animate-pulse px-4 py-6" />}>
      <AgentData />
    </Suspense>
  );
}
