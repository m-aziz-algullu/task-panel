import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_LOCALE, LOCALE_COOKIE, hasLocale } from "./config";

/**
 * redirect() to `path` in the visitor's language. Server Actions can't read the
 * [lang] segment, but the proxy stores the current one in a cookie on every page
 * view. (An unprefixed redirect would bounce through the proxy, which the client
 * router doesn't follow after a Server Action.)
 */
export async function localizedRedirect(path: `/${string}`): Promise<never> {
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = hasLocale(remembered) ? remembered : DEFAULT_LOCALE;
  redirect(`/${locale}${path === "/" ? "" : path}`);
}
