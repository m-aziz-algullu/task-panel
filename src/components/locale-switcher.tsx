"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";

/** Same page in the other language; the proxy remembers the choice in a cookie. */
export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const rest = pathname.split("/").slice(2).join("/");

  return (
    <nav aria-label={t("nav.language")} className="flex items-center rounded-md border border-border p-0.5 text-xs font-semibold">
      {LOCALES.map((option) => (
        <Link
          key={option}
          href={`/${option}${rest ? `/${rest}` : ""}`}
          hrefLang={option}
          title={LOCALE_NAMES[option]}
          aria-current={option === locale ? "true" : undefined}
          className={`rounded px-1.5 py-0.5 uppercase transition ${
            option === locale ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {option}
        </Link>
      ))}
    </nav>
  );
}
