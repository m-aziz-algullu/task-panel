// The message that starts an agent run, and reading the report the agent ends
// it with. Pure, so both can be tested.

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

const AUTHOR_LABEL = { user: "user", agent: "agent", system: "Task Panel" } as const;

/**
 * The run carries no credentials: OpenClaw masks anything that looks like one
 * before the model sees it, and the agent doesn't need to call back anyway.
 * Its final message is the report; Task Panel posts it to the task.
 */
export function buildRunPrompt(input: PromptInput): string {
  const { task, tokenLimit } = input;
  const minutes = Math.round(input.timeoutSeconds / 60);
  const budget = tokenLimit.toLocaleString("en-US");

  const sections = [
    `You are working on task #${task.id} from Task Panel, the user's personal kanban board. Do the task, then end with a report as described below.`,
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
        "## Earlier comments (oldest first)",
        ...input.comments.map((c) => `[${c.createdAt} · ${AUTHOR_LABEL[c.author]}] ${c.body}`),
      ].join("\n"),
    );
  }

  if (input.instructions.trim()) sections.push(`## Standing instructions from the user\n${input.instructions.trim()}`);

  sections.push(
    [
      "## Your report (required)",
      "Task Panel posts your final message to the task as your report, so make it complete on its own.",
      "- Start it with a line that is exactly `RESULT: done` if you completed the task, or `RESULT: blocked` if you could not.",
      "- Then the report: for `done`, what you did and the result (findings, links, file paths); for `blocked`, what stopped you and what you need from the user.",
      "- Nobody answers in this conversation, so don't end with a question: ask it in a `blocked` report instead.",
      "- Write it in the language the task is written in.",
    ].join("\n"),
  );

  sections.push(
    [
      "## Limits",
      `- Token budget: ${budget} tokens for this run, counted like OpenClaw's session usage (input, output and cache).`,
      input.limitMode === "soft"
        ? `- Before you start, create a goal for this task with \`create_goal\` and \`token_budget: ${tokenLimit}\`. If the budget runs low, stop and send a \`blocked\` report saying what is left.`
        : "- Task Panel stops the run when the budget is spent, and then your report is lost. If you are running low, wrap up and send a `blocked` report saying what is left.",
      `- Time limit: about ${minutes} minutes.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
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
