"use client";

import { useActionState } from "react";
import { useI18n } from "@/i18n/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";
import { login, register, type AuthFormState } from "./actions";

const initialState: AuthFormState = { error: null };

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input className="input" required {...input} />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

function FormError({ state }: { state: AuthFormState }) {
  const { t } = useI18n();
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {t(state.error, { min: MIN_PASSWORD_LENGTH, count: state.retryMinutes ?? 0 })}
    </p>
  );
}

export function LoginForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label={t("auth.email")}
        type="email"
        name="email"
        autoComplete="email"
        autoFocus
        defaultValue={state.email}
        key={state.email}
      />
      <Field label={t("auth.password")} type="password" name="password" autoComplete="current-password" />
      <FormError state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary justify-center">
        {pending ? t("auth.loggingIn") : t("auth.login")}
      </button>
    </form>
  );
}

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(register, initialState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label={t("auth.setupCode")}
        hint={t("auth.setupCodeHint")}
        name="setupCode"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        placeholder="XXXX-XXXX-XXXX-XXXX"
        className="input font-mono tracking-wider uppercase"
        defaultValue={state.setupCode}
        key={`c${state.setupCode}`}
      />
      <Field
        label={t("auth.name")}
        name="name"
        autoComplete="name"
        maxLength={80}
        defaultValue={state.name}
        key={`n${state.name}`}
      />
      <Field
        label={t("auth.email")}
        type="email"
        name="email"
        autoComplete="email"
        defaultValue={state.email}
        key={`e${state.email}`}
      />
      <Field
        label={t("auth.password")}
        type="password"
        name="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        placeholder={t("auth.passwordPlaceholder", { min: MIN_PASSWORD_LENGTH })}
      />
      <Field
        label={t("auth.passwordAgain")}
        type="password"
        name="confirm"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <FormError state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary justify-center">
        {pending ? t("auth.creatingAdmin") : t("auth.createAdmin")}
      </button>
    </form>
  );
}
