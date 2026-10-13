import type { Metadata } from "next";
import { localizedRedirect } from "@/i18n/redirect";
import { connection } from "next/server";
import { Suspense } from "react";
import { getI18n } from "@/i18n/server";
import { hasUsers } from "@/lib/session";
import { logSetupCode } from "@/lib/setup";
import { AuthCard, FormSkeleton } from "../auth-card";
import { RegisterForm } from "../auth-forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.register") };
}

async function RegisterGate() {
  // Sign-up exists only to create the first (admin) account. The register
  // action enforces the same rule, so posting to it directly doesn't help.
  await connection();
  if (await hasUsers()) return localizedRedirect("/login");
  // Print the code again so it's in recent logs even if startup logs rotated away.
  await logSetupCode();
  return <RegisterForm />;
}

export default async function RegisterPage() {
  const { t } = await getI18n();
  return (
    <AuthCard title={t("auth.registerTitle")} subtitle={t("auth.registerSubtitle")}>
      <Suspense fallback={<FormSkeleton fields={5} />}>
        <RegisterGate />
      </Suspense>
    </AuthCard>
  );
}
