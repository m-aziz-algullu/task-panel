import { notFound } from "next/navigation";
import { lang } from "next/root-params";
import { INTL_LOCALE, hasLocale, type Locale } from "./config";
import en from "./dictionaries/en";
import tr, { type Dictionary } from "./dictionaries/tr";
import { translate, type Translate } from "./translate";

// Server Components only (next/root-params fails the build in Client Components).

const DICTIONARIES: Record<Locale, Dictionary> = { en, tr };

export async function getI18n(): Promise<{ locale: Locale; dict: Dictionary; t: Translate }> {
  const locale = await lang();
  if (!hasLocale(locale)) notFound();
  const dict = DICTIONARIES[locale];
  return { locale, dict, t: (key, vars) => translate(dict, INTL_LOCALE[locale], key, vars) };
}
