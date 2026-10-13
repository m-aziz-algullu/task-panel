import type { Metadata } from "next";
import { Suspense } from "react";
import { CompletedView } from "@/components/completed-view";
import { CompletedSkeleton } from "@/components/skeletons";
import { getI18n } from "@/i18n/server";
import { getCompletedData } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.completed") };
}

async function CompletedData() {
  const { tasks, tags, clock } = await getCompletedData();
  return <CompletedView tasks={tasks} tags={tags} clock={clock} />;
}

export default async function CompletedPage() {
  const { t } = await getI18n();
  return (
    <Suspense fallback={<CompletedSkeleton title={t("completed.title")} />}>
      <CompletedData />
    </Suspense>
  );
}
