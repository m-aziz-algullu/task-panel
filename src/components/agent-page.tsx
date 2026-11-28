"use client";

import { Bot, Check, CircleAlert, CircleDashed, Copy, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { needsVerification, type ClaudeAuth, type ClaudeStatus } from "@/lib/agent/claude-auth";

const TERMS_URL = "https://code.claude.com/docs/en/legal-and-compliance";
/** The model the agent runs on: Sonnet 5.5, through the Claude Code CLI. */
const AGENT_MODEL = "anthropic/claude-sonnet-5-5";

export function claudeAuthLabel(auth: ClaudeAuth): MessageKey {
  switch (auth.state) {
    case "connected":
      return "agentPage.claudeConnected";
    case "expired":
      return "agentPage.claudeExpired";
    case "failing":
      return "agentPage.claudeFailing";
    case "missing":
      return "agentPage.claudeMissing";
    default:
      return "agentPage.claudeUnknown";
  }
}

const AUTH_CLASS: Record<ClaudeAuth["state"], string> = {
  connected: "bg-green-500/15 text-green-700 dark:text-green-400",
  expired: "bg-red-500/15 text-red-700 dark:text-red-400",
  failing: "bg-red-500/15 text-red-700 dark:text-red-400",
  missing: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  unknown: "bg-surface-2 text-muted",
};

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const noSubscribe = () => () => {};
/** The current minute in the browser; null while rendering on the server. */
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** "3 hours ago", worked out in the browser (the server only knows the date). */
function Ago({ at }: { at: string }) {
  const { intlLocale } = useI18n();
  const now = useSyncExternalStore(noSubscribe, currentMinute, () => null);
  if (now == null) return <time dateTime={at}>{at.slice(0, 10)}</time>;
  const diff = new Date(at).getTime() - now;
  const format = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  const [unit, ms] = RELATIVE_STEPS.find(([, size]) => Math.abs(diff) >= size) ?? ["minute", 60_000];
  return (
    <time dateTime={at} title={new Date(at).toLocaleString(intlLocale)}>
      {format.format(Math.round(diff / ms), unit)}
    </time>
  );
}

/** Splits a message around its {when} placeholder so a live <Ago> can sit in it. */
function WithWhen({ text, at }: { text: string; at: string }) {
  const [before, after = ""] = text.split("{when}");
  return (
    <>
      {before}
      <Ago at={at} />
      {after}
    </>
  );
}

function Command({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
      <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">{value}</code>
      <button
        type="button"
        className="icon-btn size-6 shrink-0"
        title={copied ? t("agentPage.copied") : t("agentPage.copy")}
        aria-label={t("agentPage.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function Step({
  index,
  text,
  done,
  children,
}: {
  index: number;
  text: string;
  /** Shown as a check when known; steps the app can't observe pass null. */
  done?: boolean | null;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
        {index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{text}</span>
          {done === true && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
              <Check className="size-3.5" /> {t("agentPage.done")}
            </span>
          )}
          {done === false && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <CircleDashed className="size-3.5" /> {t("agentPage.pending")}
            </span>
          )}
        </div>
        {children}
      </div>
    </li>
  );
}

export function AgentPage({
  initial,
  container,
  ephemeral,
}: {
  initial: ClaudeStatus;
  /** Running in the Docker image (else `npm run dev` next to `npm run agent:dev`). */
  container: boolean;
  ephemeral: boolean;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // A real check: OpenClaw re-reads the credentials, then Claude gets one tiny turn.
  const check = useCallback(() => {
    setChecking(true);
    setCheckError(null);
    fetch("/api/agent/claude/check", { method: "POST", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((next: { status: ClaudeStatus; error: string | null }) => {
        setStatus(next.status);
        setCheckError(next.error);
      })
      .catch((error: Error) => setCheckError(error.message))
      .finally(() => setChecking(false));
  }, []);

  // The config alone can't tell a dead OAuth session from a live one, so a sign-in
  // nothing has proven lately is checked as soon as the page opens.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || !needsVerification(initial.auth, Date.now())) return;
    autoChecked.current = true;
    check();
  }, [initial.auth, check]);

  const { gateway, auth, cliFound } = status;
  const connected = auth.state === "connected";
  const openclaw = container ? "openclaw" : "npm run agent:cli --";
  // The login picks OpenClaw's default model; Task Panel runs on Sonnet through the same CLI.
  const linkCommand = [
    `${openclaw} models auth login --provider anthropic --method cli --set-default`,
    `${openclaw} config set agents.defaults.models.${AGENT_MODEL}.agentRuntime.id claude-cli`,
    `${openclaw} models set ${AGENT_MODEL}`,
  ].join("\n");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Bot className="size-5 text-accent" /> {t("agentPage.title")}
        </h1>
        <p className="text-sm text-muted">{t("agentPage.subtitle")}</p>
      </div>

      {gateway.state === "disabled" ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">{t("agentPage.disabled")}</p>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">{t("agentPage.gatewayTitle")}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  gateway.state === "ready"
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : gateway.state === "error"
                      ? "bg-red-500/15 text-red-700 dark:text-red-400"
                      : "bg-surface-2 text-muted"
                }`}
              >
                {t(
                  gateway.state === "ready"
                    ? "agentPage.gatewayReady"
                    : gateway.state === "error"
                      ? "agentPage.gatewayError"
                      : "agentPage.gatewayConnecting",
                )}
              </span>
              {gateway.version && (
                <span className="text-xs text-muted">{t("agentPage.version", { version: gateway.version })}</span>
              )}
              {gateway.error && <span className="text-xs text-red-600 dark:text-red-400">{gateway.error}</span>}
              <a href="/api/agent/control-ui" target="_blank" rel="noopener" className="btn btn-outline ml-auto">
                <ExternalLink className="size-4" /> {t("agentPage.controlUi")}
              </a>
            </div>
            <p className="text-xs text-muted">{t("agentPage.controlUiHint")}</p>
          </section>

          {ephemeral && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {t("agentPage.ephemeral")}
            </p>
          )}

          <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <KeyRound className="size-4 text-accent" />
              <h2 className="text-base font-semibold">{t("agentPage.claudeTitle")}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                auth.state === "connected" && !auth.verifiedAt && !checking
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : AUTH_CLASS[auth.state]
              }`}>
                {auth.state === "connected" && !auth.verifiedAt
                  ? t(checking ? "agentPage.checking" : "agentPage.claudeUnverified")
                  : t(claudeAuthLabel(auth))}
              </span>
              {auth.state === "connected" && (
                <span className="text-xs text-muted">
                  {t(auth.method === "subscription" ? "agentPage.methodSubscription" : "agentPage.methodApiKey")}
                  {auth.email && ` · ${auth.email}`}
                  {" · "}
                  {auth.verifiedAt ? (
                    <WithWhen text={t("agentPage.verifiedAt")} at={auth.verifiedAt} />
                  ) : (
                    t("agentPage.notVerified")
                  )}
                </span>
              )}
              <button type="button" className="btn btn-ghost ml-auto" disabled={checking} onClick={check}>
                <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
                {checking ? t("agentPage.checking") : t("agentPage.check")}
              </button>
            </div>

            {(auth.state === "expired" || auth.state === "failing") && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-300"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold">
                    {t(auth.state === "expired" ? "agentPage.expiredTitle" : "agentPage.failingTitle")}
                  </span>
                  <span>{t(auth.state === "expired" ? "agentPage.expiredBody" : "agentPage.failingBody")}</span>
                  {auth.at && auth.source !== "openclaw" && (
                    <span className="text-xs">
                      <WithWhen
                        text={t(auth.source === "run" ? "agentPage.expiredSeenRun" : "agentPage.expiredSeenCheck")}
                        at={auth.at}
                      />
                    </span>
                  )}
                  {auth.error && <code className="font-mono text-xs break-all">{auth.error}</code>}
                </div>
              </div>
            )}

            {checkError && (
              <p className="text-xs text-red-600 dark:text-red-400">{t("agentPage.checkFailed", { error: checkError })}</p>
            )}

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{t("agentPage.howTo")}</h3>
              <p className="text-xs text-muted">{t("agentPage.howToIntro")}</p>
              {container ? (
                <ol className="flex flex-col gap-4">
                  <Step index={1} text={t("agentPage.stepShell")}>
                    <Command value="docker exec -it -u node <container> /srv/docker/agent-shell.sh" />
                    <span className="text-xs text-muted">{t("agentPage.stepShellHint")}</span>
                    <Command value="runuser -u node -- /srv/docker/agent-shell.sh" />
                  </Step>
                  <Step index={2} text={t("agentPage.stepInstall")} done={cliFound}>
                    <Command value="curl -fsSL https://claude.ai/install.sh | bash" />
                  </Step>
                  <Step index={3} text={t("agentPage.stepLogin")}>
                    <Command value="claude auth login" />
                  </Step>
                  <Step index={4} text={t("agentPage.stepLink")} done={connected}>
                    <Command value={linkCommand} />
                  </Step>
                  <Step index={5} text={t("agentPage.stepCheck")} done={connected} />
                </ol>
              ) : (
                <ol className="flex flex-col gap-4">
                  <Step index={1} text={t("agentPage.stepLocalCli")} done={cliFound}>
                    <Command value="claude auth login" />
                  </Step>
                  <Step index={2} text={t("agentPage.stepLocalLink")} done={connected}>
                    <Command value={linkCommand} />
                  </Step>
                  <Step index={3} text={t("agentPage.stepCheck")} done={connected} />
                </ol>
              )}
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 self-start text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                {t("agentPage.terms")} <ExternalLink className="size-3" />
              </a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
