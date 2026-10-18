"use client";

import { Bot, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { startAgentRun, stopAgentRun } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import type { AgentOptions } from "@/lib/agent/options";
import { claudeAuthLabel } from "./agent-page";
import { MAX_TOKEN_LIMIT, MIN_TOKEN_LIMIT } from "@/lib/agent/settings-shape";
import {
  ACTIVE_RUN_STATUSES,
  LIMIT_MODES,
  TOKEN_PRESETS,
  type AgentRun,
  type AgentRunInput,
  type LimitMode,
  type RunStatus,
  type TokenPreset,
} from "@/lib/types";

export const RUN_STATUS_LABEL: Record<RunStatus, MessageKey> = {
  queued: "agentRun.statusQueued",
  running: "agentRun.statusRunning",
  done: "agentRun.statusDone",
  blocked: "agentRun.statusBlocked",
  failed: "agentRun.statusFailed",
  timed_out: "agentRun.statusTimedOut",
  budget_exceeded: "agentRun.statusBudgetExceeded",
  aborted: "agentRun.statusAborted",
};

const PRESET_LABEL: Record<TokenPreset, MessageKey> = {
  simple: "agentRun.presetSimple",
  medium: "agentRun.presetMedium",
  hard: "agentRun.presetHard",
};

const RUN_STATUS_CLASS: Record<RunStatus, string> = {
  queued: "bg-agent/15 text-agent",
  running: "bg-agent text-white dark:text-gray-950",
  done: "bg-green-500/15 text-green-700 dark:text-green-400",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  timed_out: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  budget_exceeded: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  aborted: "bg-surface-2 text-muted",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useI18n();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RUN_STATUS_CLASS[status]}`}>
      {t(RUN_STATUS_LABEL[status])}
    </span>
  );
}

type Form = AgentRunInput & { preset: TokenPreset | "custom" };

/** The previous run's settings when there is one (a follow-up usually wants the same), else the defaults. */
function initialForm(options: AgentOptions, previous: AgentRun | null): Form {
  const { settings } = options;
  if (previous) {
    const preset = TOKEN_PRESETS.find((p) => settings.tokenPresets[p] === previous.tokenLimit) ?? "custom";
    return {
      agentId: previous.agentId,
      model: previous.model,
      thinking: previous.thinking,
      timeoutSeconds: previous.timeoutSeconds,
      tokenLimit: previous.tokenLimit,
      limitMode: previous.limitMode,
      preset,
    };
  }
  return {
    agentId: settings.agentId,
    model: settings.model,
    thinking: settings.thinking,
    timeoutSeconds: settings.timeoutSeconds,
    tokenLimit: settings.tokenPresets[settings.defaultPreset],
    limitMode: settings.limitMode,
    preset: settings.defaultPreset,
  };
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`btn px-2 py-1 text-xs ${value === option.value ? "bg-agent text-white dark:text-gray-950" : "btn-ghost border border-border"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type AgentRunPanelProps = {
  taskId: number;
  run: AgentRun | null;
  /** Reloads the dialog's run and comments after starting or stopping. */
  onChange: () => void;
};

export function AgentRunPanel({ taskId, run, onChange }: AgentRunPanelProps) {
  const { t, intlLocale, locale } = useI18n();
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  // The form starts from the latest run, which may load after the options do.
  const latestRun = useRef(run);
  useEffect(() => {
    latestRun.current = run;
  }, [run]);
  const [pending, startTransition] = useTransition();
  const compact = useMemo(() => new Intl.NumberFormat(intlLocale, { notation: "compact" }), [intlLocale]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/options", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: AgentOptions) => {
        if (cancelled) return;
        setOptions(data);
        setForm((current) => current ?? initialForm(data, latestRun.current));
      })
      .catch(() => {
        if (!cancelled) setError("errors.agentUnavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = run != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const thinkingLevels = useMemo(() => {
    if (!options || !form) return [];
    const model = options.models.find((m) => m.ref === form.model);
    const levels = model ? model.thinkingLevels : options.models.flatMap((m) => m.thinkingLevels);
    return [...new Set(levels)];
  }, [options, form]);

  const give = () => {
    if (!form) return;
    const input: AgentRunInput = {
      agentId: form.agentId,
      model: form.model,
      thinking: form.thinking,
      timeoutSeconds: form.timeoutSeconds,
      tokenLimit: form.tokenLimit,
      limitMode: form.limitMode,
    };
    startTransition(async () => {
      const result = await startAgentRun(taskId, input, fresh);
      if (!result.ok) return setError(result.error);
      setError(null);
      onChange();
    });
  };

  const stop = () => {
    if (!confirm(t("agentRun.stopConfirm"))) return;
    startTransition(async () => {
      const result = await stopAgentRun(taskId);
      if (!result.ok) return setError(result.error);
      onChange();
    });
  };

  const connected = options?.status.state === "ready";

  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border p-3 ${
        active ? "border-agent bg-agent/5 ring-2 ring-agent/20" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-agent" />
        <span className="text-xs font-semibold">{t("agentRun.title")}</span>
        {run && active && <RunStatusBadge status={run.status} />}
      </div>

      {run && active && (
        <div className="flex flex-col gap-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-agent transition-[width]"
              style={{ width: `${Math.min(100, (run.tokensUsed / run.tokenLimit) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {t("agentRun.tokens", { used: compact.format(run.tokensUsed), limit: compact.format(run.tokenLimit) })} ·{" "}
            {t(run.limitMode === "hard" ? "agentRun.hard" : "agentRun.soft")}
            {run.model && ` · ${run.model}`}
          </p>
          <button type="button" className="btn btn-danger self-start" disabled={pending} onClick={stop}>
            <Square className="size-3.5" /> {t("agentRun.stop")}
          </button>
        </div>
      )}

      {!active && options && !connected && <p className="text-xs text-muted">{t("agentRun.unavailable")}</p>}

      {options && connected && (
        <p
          className={`flex flex-wrap items-center gap-1 text-xs ${
            options.claude.state === "connected" ? "text-muted" : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {t("agentPage.claudeTitle")}: {t(claudeAuthLabel(options.claude))}
          {options.claude.state === "connected" && options.claude.method === "subscription" && (
            <> · {t("agentPage.methodSubscription")}</>
          )}
          {options.claude.state !== "connected" && (
            <Link href={`/${locale}/agent`} className="font-semibold underline underline-offset-2">
              {t("agentPage.openPage")}
            </Link>
          )}
        </p>
      )}

      {!active && form && options && (
        <div className="flex flex-col gap-3">
          {options.agents.length > 1 && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("agentRun.agentId")}
              <select
                className="input py-1 text-sm"
                value={form.agentId ?? ""}
                onChange={(event) => set("agentId", event.target.value || null)}
              >
                <option value="">{t("agentRun.defaultOption")}</option>
                {options.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("agentRun.model")}
            <select
              className="input py-1 text-sm"
              value={form.model ?? ""}
              onChange={(event) => set("model", event.target.value || null)}
            >
              <option value="">{t("agentRun.defaultOption")}</option>
              {options.models.map((model) => (
                <option key={model.ref} value={model.ref}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>

          {thinkingLevels.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("agentRun.thinking")}
              <select
                className="input py-1 text-sm"
                value={form.thinking ?? ""}
                onChange={(event) => set("thinking", event.target.value || null)}
              >
                <option value="">{t("agentRun.defaultOption")}</option>
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("agentRun.tokenLimit")}</span>
            <Choice<TokenPreset | "custom">
              value={form.preset}
              options={[
                ...TOKEN_PRESETS.map((preset) => ({
                  value: preset,
                  label: `${t(PRESET_LABEL[preset])} · ${compact.format(options.settings.tokenPresets[preset])}`,
                })),
                { value: "custom" as const, label: t("agentRun.custom") },
              ]}
              onChange={(preset) =>
                setForm((f) =>
                  f
                    ? {
                        ...f,
                        preset,
                        tokenLimit: preset === "custom" ? f.tokenLimit : options.settings.tokenPresets[preset],
                      }
                    : f,
                )
              }
            />
            {form.preset === "custom" && (
              <input
                type="number"
                className="input py-1 text-sm"
                min={MIN_TOKEN_LIMIT}
                max={MAX_TOKEN_LIMIT}
                step={1000}
                value={form.tokenLimit}
                onChange={(event) => set("tokenLimit", Number(event.target.value))}
              />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("agentRun.limitMode")}</span>
            <Choice<LimitMode>
              value={form.limitMode}
              options={LIMIT_MODES.map((mode) => ({
                value: mode,
                label: t(mode === "hard" ? "agentRun.hard" : "agentRun.soft"),
                title: t(mode === "hard" ? "agentRun.hardHint" : "agentRun.softHint"),
              }))}
              onChange={(mode) => set("limitMode", mode)}
            />
            <span className="text-[11px] text-muted">
              {t(form.limitMode === "hard" ? "agentRun.hardHint" : "agentRun.softHint")}
            </span>
          </div>

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("agentRun.timeout")}
            <input
              type="number"
              className="input py-1 text-sm"
              min={1}
              max={360}
              value={Math.round(form.timeoutSeconds / 60)}
              onChange={(event) => set("timeoutSeconds", Math.round(Number(event.target.value) * 60))}
            />
          </label>

          {run && (
            <label className="flex items-start gap-2 text-xs text-muted" title={t("agentRun.freshHint")}>
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--agent)]"
                checked={fresh}
                onChange={(event) => setFresh(event.target.checked)}
              />
              <span>
                {t("agentRun.freshStart")}
                <span className="block text-[11px]">{t("agentRun.freshHint")}</span>
              </span>
            </label>
          )}

          <button
            type="button"
            className="btn bg-agent text-white hover:brightness-110 dark:text-gray-950"
            disabled={pending || !connected}
            onClick={give}
          >
            <Bot className="size-4" /> {t(run && !fresh ? "agentRun.continue" : "agentRun.give")}
          </button>
        </div>
      )}

      {run && !active && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {t("agentRun.lastRun")}: <RunStatusBadge status={run.status} />
          {t("agentRun.tokens", { used: compact.format(run.tokensUsed), limit: compact.format(run.tokenLimit) })}
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
    </section>
  );
}
