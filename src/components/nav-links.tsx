"use client";

import { CheckCheck, KanbanSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";

export function NavLinks() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const links = [
    { href: `/${locale}`, label: t("nav.board"), icon: KanbanSquare },
    { href: `/${locale}/completed`, label: t("nav.completed"), icon: CheckCheck },
  ];

  return (
    <nav className="flex items-center gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`btn ${active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
