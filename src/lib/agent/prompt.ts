// The messages that start and continue an agent run, and reading the report the
// agent ends each run with. Pure, so all of it can be tested.

import { MAX_COMMENT_LENGTH, type LimitMode, type Task, type TaskComment } from "../types";

export type PromptInput = {
  task: Pick<Task, "id" | "title" | "description" | "status" | "day">;
  tagNames: string[];
  comments: Pick<TaskComment, "author" | "body" | "createdAt">[];
  instructions: string;
  tokenLimit: number;
  limitMode: LimitMode;
  timeoutSeconds: number;
};

type Limits = Pick<PromptInput, "tokenLimit" | "limitMode" | "timeoutSeconds">;

const AUTHOR_LABEL = { user: "user", agent: "agent", system: "Task Panel" } as const;

/**
 * Every model call re-reads the whole conversation, so whatever a step pulls in
 * is paid for again on every later step. The agent has no browser (its page
 * snapshots run to tens of thousands of tokens). Shared with the panel chat.
 */
export const WORK_RULES = [
  "- To look something up, use your web search tool; to read a page, use web fetch. There is no browser here.",
  "- Keep it lean: as few steps and pages as the task needs, and only the parts of a page you need.",
];

function workSection(): string {
  return ["## How to work", ...WORK_RULES].join("\n");
}

function reportSection(): string {
  return [
    "## Your report (required)",
    "Task Panel posts your final message to the task as your report, so make it complete on its own.",
    "- Start it with a line that is exactly `RESULT: done` if you completed the task, or `RESULT: blocked` if you could not.",
    "- Then the report: for `done`, what you did and the result (findings, links, file paths); for `blocked`, what stopped you and what you need from the user.",
    "- The user answers with a comment on the task, which comes back to you in this conversation. Don't end with a question: ask it in a `blocked` report instead.",
    "- Write it in the language the task is written in.",
  ].join("\n");
}

function limitsSection({ tokenLimit, limitMode, timeoutSeconds }: Limits): string {
  return [
    "## Limits",
    `- Token budget: ${tokenLimit.toLocaleString("en-US")} tokens for this run, counted like OpenClaw's session usage (input, output and cache).`,
    limitMode === "soft"
      ? `- Before you start, create a goal for this task with \`create_goal\` and \`token_budget: ${tokenLimit}\`. If the budget runs low, stop and send a \`blocked\` report saying what is left.`
      : "- Task Panel stops the run when the budget is spent, and then your report is lost. If you are running low, wrap up and send a `blocked` report saying what is left.",
    `- Time limit: about ${Math.round(timeoutSeconds / 60)} minutes.`,
  ].join("\n");
}

/**
 * The first turn of a task's conversation. It carries no credentials: OpenClaw
 * masks anything that looks like one before the model sees it, and the agent
 * doesn't need to call back anyway. Its final message is the report; Task Panel
 * posts it to the task.
 */
export function buildRunPrompt(input: PromptInput): string {
  const { task } = input;
  const sections = [
    `You are working on task #${task.id} from Task Panel, the user's personal kanban board. Do the task, then end with a report as described below. Use what your memory (USER.md, MEMORY.md) says about the user and their preferences.`,
    [
      "## Task",
      `Title: ${task.title}`,
      `Status: ${task.status} · Day: ${task.day}${input.tagNames.length ? ` · Tags: ${input.tagNames.join(", ")}` : ""}`,
      "Description:",
      task.description.trim() || "(none)",
    ].join("\n"),
  ];

  if (input.comments.length > 0) {
    sections.push(
      [
        "## Earlier comments (oldest first; the user's latest ones are instructions for this run)",
        ...input.comments.map((c) => `[${c.createdAt} · ${AUTHOR_LABEL[c.author]}] ${c.body}`),
      ].join("\n"),
    );
  }

  if (input.instructions.trim()) sections.push(`## Standing instructions from the user\n${input.instructions.trim()}`);

  sections.push(workSection(), reportSection(), limitsSection(input));
  return sections.join("\n\n");
}

export type FollowUpInput = Limits & {
  task: Pick<Task, "id" | "title" | "description">;
  /** The user's comments since the previous run started, oldest first. */
  newComments: Pick<TaskComment, "body" | "createdAt">[];
};

/**
 * The next turn in a task's existing conversation. Short on purpose: the agent
 * still has everything from before in the session, so it only gets what's new.
 */
export function buildFollowUpPrompt(input: FollowUpInput): string {
  const { task } = input;
  return [
    `Task Panel: the user followed up on task #${task.id} ("${task.title}"). Continue from where you left off in this conversation: take their comments into account, answer them, change course or carry on with the work as they ask.`,
    input.newComments.length > 0
      ? ["## New comments from the user (oldest first)", ...input.newComments.map((c) => `[${c.createdAt}] ${c.body}`)].join(
          "\n",
        )
      : "## New comments from the user\n(none: the user asked you to carry on with the task)",
    ["## The task as it stands", `Title: ${task.title}`, "Description:", task.description.trim() || "(none)"].join("\n"),
    workSection(),
    reportSection(),
    limitsSection(input),
  ].join("\n\n");
}

export type RunReport = { outcome: "done" | "blocked"; body: string };

// `RESULT: done`, also when the model dresses it up as **RESULT: done** or `RESULT: done`.
const RESULT_LINE = /^[\s*_`>#]*RESULT\s*:\s*(done|blocked)\b[*_`]*[ \t]*(?:\r?\n|$)/i;

/**
 * The agent's final message as a task comment. Without the RESULT line the
 * message still counts as the report (done); an empty one is no report at all.
 */
export function parseRunReport(text: string | null | undefined): RunReport | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const match = RESULT_LINE.exec(trimmed);
  const outcome = (match?.[1]?.toLowerCase() as RunReport["outcome"] | undefined) ?? "done";
  const body = (match ? trimmed.slice(match[0].length).trim() : trimmed) || trimmed;
  return {
    outcome,
    body: body.length > MAX_COMMENT_LENGTH ? `${body.slice(0, MAX_COMMENT_LENGTH - 1)}…` : body,
  };
}
