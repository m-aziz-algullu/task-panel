"use server";

import { eq, sql } from "drizzle-orm";
import { localizedRedirect } from "@/i18n/redirect";
import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { MIN_PASSWORD_LENGTH, hashPassword, normalizeEmail, timingDummyHash, verifyPassword } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { endSession, hasUsers, startSession } from "@/lib/session";
import { clearSetupCode, getOrCreateSetupCode } from "@/lib/setup";
import { setupCodeMatches } from "@/lib/setup-code";

const { users } = schema;

/** `error` is a message key; the form translates it. */
export type AuthFormState = { error: MessageKey | null; name?: string; email?: string; setupCode?: string };

const msg = (key: MessageKey) => key;

const registerInput = z
  .object({
    name: z.string().trim().min(1, msg("errors.nameRequired")).max(80, msg("errors.nameTooLong")),
    email: z.email(msg("errors.emailInvalid")),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, msg("errors.passwordTooShort"))
      .max(200, msg("errors.passwordTooLong")),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: msg("errors.passwordMismatch"), path: ["confirm"] });

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

/** Slows down guessing without needing any stored state. */
const penalty = () => new Promise((resolve) => setTimeout(resolve, 600));

/**
 * Creates the one and only (admin) account. Needs the setup code from the
 * server logs, and is refused once any account exists.
 */
export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = field(formData, "name");
  const email = normalizeEmail(field(formData, "email"));
  const setupCode = field(formData, "setupCode");
  const parsed = registerInput.safeParse({
    name,
    email,
    password: field(formData, "password"),
    confirm: field(formData, "confirm"),
  });
  if (!parsed.success) {
    const error = (parsed.error.issues[0]?.message as MessageKey | undefined) ?? "errors.invalid";
    return { error, name, email, setupCode };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const db = await getDb();
  const outcome = await db.transaction(async (tx) => {
    // Two simultaneous sign-ups must not both see an empty users table.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(727275)`);
    if (await hasUsers(tx)) return "closed" as const;
    if (!setupCodeMatches(setupCode, await getOrCreateSetupCode(tx))) return "badCode" as const;
    const [user] = await tx
      .insert(users)
      .values({ name: parsed.data.name, email, passwordHash, role: "admin" })
      .returning({ id: users.id });
    await clearSetupCode(tx);
    return user.id;
  });
  if (outcome === "closed") return localizedRedirect("/login");
  if (outcome === "badCode") {
    await penalty();
    return { error: "errors.setupCodeInvalid", name, email };
  }

  await startSession(db, outcome);
  return localizedRedirect("/");
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");
  const db = await getDb();

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  // Verify against a dummy hash for unknown e-mails so timing doesn't reveal which accounts exist.
  const valid = await verifyPassword(password, user?.passwordHash ?? (await timingDummyHash()));
  if (!user || !valid) {
    if (!(await hasUsers(db))) return localizedRedirect("/register");
    await penalty();
    return { error: "errors.loginFailed", email };
  }

  await startSession(db, user.id);
  return localizedRedirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  return localizedRedirect("/login");
}
