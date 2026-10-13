"use client";

import { createContext, useContext, useMemo } from "react";
import { INTL_LOCALE, type Locale } from "./config";
import type { Dictionary } from "./dictionaries/tr";
import { translate, type Translate } from "./translate";

type I18n = { locale: Locale; intlLocale: string; t: Translate };

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: React.ReactNode }) {
  const value = useMemo<I18n>(() => {
    const intlLocale = INTL_LOCALE[locale];
    return { locale, intlLocale, t: (key, vars) => translate(dict, intlLocale, key, vars) };
  }, [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>.");
  return value;
}
