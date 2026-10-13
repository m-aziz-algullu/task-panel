import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";
import { LOCALE_COOKIE, hasLocale, pickLocale } from "@/i18n/config";

const PUBLIC_PAGES = /^\/(login|register)(\/|$)/;
const ONE_YEAR = 60 * 60 * 24 * 365;

// 1. Paths without a locale (/, /login, redirects from Server Actions) get the
//    visitor's locale: remembered choice, then the browser's language.
// 2. Optimistic auth gate: no session cookie means the login page. Whether the
//    session is valid is checked against the database by every data read and
//    Server Action (see src/lib/session.ts).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const segment = pathname.split("/")[1];

  if (!hasLocale(segment)) {
    const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = hasLocale(remembered) ? remembered : pickLocale(request.headers.get("accept-language"));
    return NextResponse.redirect(new URL(`/${locale}${pathname === "/" ? "" : pathname}${search}`, request.url));
  }

  const rest = pathname.slice(segment.length + 1) || "/";
  const response =
    request.cookies.has(SESSION_COOKIE) || PUBLIC_PAGES.test(rest)
      ? NextResponse.next()
      : NextResponse.redirect(new URL(`/${segment}/login`, request.url));

  if (request.cookies.get(LOCALE_COOKIE)?.value !== segment) {
    response.cookies.set(LOCALE_COOKIE, segment, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  }
  return response;
}

export const config = {
  // Everything except API routes, Next.js internals and files with an extension.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
