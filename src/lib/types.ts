// Client-safe types and constants shared by the server and the browser.

import type { JSONContent } from "@tiptap/core";

export const STATUSES = ["backlog", "in_progress", "pending", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_META: Record<Status, { label: string; dot: string }> = {
  backlog: { label: "Backlog", dot: "#94a3b8" },
  in_progress: { label: "In Progress", dot: "#3b82f6" },
  pending: { label: "Pending", dot: "#f59e0b" },
  done: { label: "Done", dot: "#22c55e" },
};

export const STORY_POINTS = [1, 2, 3, 5, 8, 13, 21] as const;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

export type Task = {
  id: number;
  title: string;
  /** Plain text of the description (card preview, search). */
  description: string;
  /** Rich text description as editor JSON; null for none or for tasks saved before the editor. */
  descriptionDoc: JSONContent | null;
  status: Status;
  storyPoints: number | null;
  /** The day the task belongs to, as YYYY-MM-DD. */
  day: string;
  position: number;
  tagIds: number[];
  createdAt: string;
  completedAt: string | null;
  /** Day (YYYY-MM-DD, app time zone) the task was completed on. */
  completedDay: string | null;
};

export type TaskInput = {
  title: string;
  /** Editor JSON; the server validates it and derives the plain text. */
  descriptionDoc: JSONContent | null;
  status: Status;
  storyPoints: number | null;
  day: string;
  /** Day (YYYY-MM-DD) to record the completion on; only used while the status is done. */
  completedDay?: string;
  tagIds: number[];
};

/** Who wrote a comment: you, the agent working on the task, or the app reporting on a run. */
export const COMMENT_AUTHORS = ["user", "agent", "system"] as const;
export type CommentAuthor = (typeof COMMENT_AUTHORS)[number];

export const MAX_COMMENT_LENGTH = 10_000;

export type TaskComment = {
  id: number;
  taskId: number;
  author: CommentAuthor;
  body: string;
  createdAt: string;
};

export type TagInput = {
  name: string;
  color: string;
};

/** Values the server computes per request so every client agrees on "today". */
export type Clock = {
  today: string;
  timeZone: string;
  /** Epoch ms at which the next day starts in the app time zone. */
  nextDayAt: number;
};
