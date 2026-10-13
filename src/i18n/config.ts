// Client-safe locale settings. URLs carry the locale as their first segment (/en/…, /tr/…).

export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "tp_locale";

/** BCP 47 tags for Intl date and plural formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", tr: "tr-TR" };

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", tr: "Türkçe" };

export function hasLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Best supported locale for an Accept-Language header, honouring q-values. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { language: tag.toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .filter((entry) => entry.language && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.find((entry) => hasLocale(entry.language))?.language as Locale | undefined ?? DEFAULT_LOCALE;
}
