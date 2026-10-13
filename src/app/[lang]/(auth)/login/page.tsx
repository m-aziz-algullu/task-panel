import type { Metadata } from "next";
import { localizedRedirect } from "@/i18n/redirect";
import { Suspense } from "react";
import { getI18n } from "@/i18n/server";
import { getCurrentUser, hasUsers } from "@/lib/session";
import { AuthCard, FormSkeleton } from "../auth-card";
import { LoginForm } from "../auth-forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.login") };
}

async function LoginGate() {
  if (await getCurrentUser()) return localizedRedirect("/");
  // Fresh install: the first visitor sets up the admin account instead.
  if (!(await hasUsers())) return localizedRedirect("/register");
  return <LoginForm />;
}

export default async function LoginPage() {
  const { t } = await getI18n();
  return (
    <AuthCard title={t("meta.appName")} subtitle={t("auth.loginSubtitle")}>
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <LoginGate />
      </Suspense>
    </AuthCard>
  );
}
