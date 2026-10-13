// Client-safe types and constants shared by the server and the browser.

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
  description: string;
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
  description: string;
  status: Status;
  storyPoints: number | null;
  day: string;
  tagIds: number[];
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
