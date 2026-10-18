// The message that starts an agent run. Pure, so it can be tested.

import type { LimitMode, Task, TaskComment } from "../types";

export type PromptInput = {
  task: Pick<Task, "id" | "title" | "description" | "status" | "day">;
  tagNames: string[];
  comments: Pick<TaskComment, "author" | "body" | "createdAt">[];
  instructions: string;
  /** Task Panel's address as seen from the agent. */
  apiBase: string;
  runToken: string;
  tokenLimit: number;
  limitMode: LimitMode;
  timeoutSeconds: number;
};

const AUTHOR_LABEL = { user: "user", agent: "agent", system: "Task Panel" } as const;

export function buildRunPrompt(input: PromptInput): string {
  const { task, apiBase, runToken, tokenLimit } = input;
  const api = `${apiBase.replace(/\/$/, "")}/api/agent`;
  const minutes = Math.round(input.timeoutSeconds / 60);
  const budget = tokenLimit.toLocaleString("en-US");

  const sections = [
    `You are working on task #${task.id} from Task Panel, the user's personal kanban board. Do the task, then report back through the Task Panel API as described below.`,
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
      "## Reporting back (required)",
      `Send every request with the header \`Authorization: Bearer ${runToken}\`. The token only works for this task while this run lasts.`,
      `- \`GET ${api}/task\`: this task and its comments as JSON.`,
      `- \`POST ${api}/comments\` with \`{"body": "..."}\`: a short progress note. Optional; keep them few.`,
      `- \`POST ${api}/finish\` with \`{"outcome": "done" | "blocked", "summary": "..."}\`: **required, exactly once, as your last step.**`,
      `  - \`done\`: what you did and the result (findings, links, file paths).`,
      `  - \`blocked\`: what stopped you and what you need from the user.`,
      "Use JSON bodies with `Content-Type: application/json` (curl works). Write comments and the summary in the language the task is written in.",
    ].join("\n"),
  );

  sections.push(
    [
      "## Limits",
      `- Token budget: ${budget} tokens for this run, counted like OpenClaw's session usage (input, output and cache).`,
      input.limitMode === "soft"
        ? `- Before you start, create a goal for this task with \`create_goal\` and \`token_budget: ${tokenLimit}\`. If the budget runs low, stop and call finish with \`blocked\`, saying what is left.`
        : "- Task Panel stops the run when the budget is spent. Leave room to call finish: if you are running low, wrap up and call finish with `blocked`, saying what is left.",
      `- Time limit: about ${minutes} minutes.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}
