import { LogOut } from "lucide-react";
import { Suspense } from "react";
import { AgentChat } from "@/components/agent-chat";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { getI18n } from "@/i18n/server";
import { agentEnabled } from "@/lib/openclaw/connection";
import { getCurrentUser } from "@/lib/session";
import { logout } from "../(auth)/actions";

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { t } = await getI18n();
  return (
    <>
      <span className="hidden max-w-48 truncate px-2 text-sm text-muted sm:inline" title={user.email}>
        {user.name}
      </span>
      <form action={logout}>
        <button type="submit" className="icon-btn" title={t("nav.logout")} aria-label={t("nav.logout")}>
          <LogOut className="size-4" />
        </button>
      </form>
    </>
  );
}

/** The chat with the agent, when this setup has one. */
async function ChatLauncher() {
  if (!(await getCurrentUser()) || !agentEnabled()) return null;
  return <AgentChat />;
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4">
          <span className="flex items-center gap-2 font-semibold">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">
              TP
            </span>
            <span className="hidden sm:inline">{t("meta.appName")}</span>
          </span>
          <NavLinks />
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <Suspense fallback={null}>
        <ChatLauncher />
      </Suspense>
    </>
  );
}
