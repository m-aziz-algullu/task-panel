// When a routine comes due: daily, on chosen weekdays, or a cron expression.
// Pure and client-safe; the server computes `next_run_at` with it on every save
// and every time the routine fires, the routine dialog uses it for the preview.

import { z } from "zod";
import { addDays, wallClock, weekday, zonedInstant } from "./dates";

/** Weekdays in cron numbering (0 = Sunday), in the order the form shows them. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export const MAX_CRON_LENGTH = 100;
/**
 * Every firing puts a task on the board (and maybe in the agent's queue), so an
 * expression may fire at most this many times an hour: `* 8 * * *` is a typo, not a plan.
 */
export const MAX_FIRINGS_PER_HOUR = 4;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type RoutineSchedule =
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "cron"; expression: string };

export const SCHEDULE_KINDS = ["daily", "weekly", "cron"] as const satisfies readonly RoutineSchedule["kind"][];

// ---------------------------------------------------------------------------
// Cron

type Field = { min: number; max: number; names?: readonly string[] };

const MINUTE: Field = { min: 0, max: 59 };
const HOUR: Field = { min: 0, max: 23 };
const DAY_OF_MONTH: Field = { min: 1, max: 31 };
const MONTH: Field = {
  min: 1,
  max: 12,
  names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
};
// 7 is Sunday too, as in most crons.
const DAY_OF_WEEK: Field = { min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] };

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export type CronSpec = {
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Both day fields restricted: a day matches either one (classic cron semantics). */
  eitherDay: boolean;
};

function parseValue(text: string, field: Field): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  const index = field.names?.indexOf(text.toLowerCase()) ?? -1;
  if (index < 0) return null;
  return index + field.min;
}

function parseField(text: string, field: Field): number[] | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/i.exec(part);
    if (!match) return null;
    const [, range, stepText] = match;
    const step = stepText == null ? 1 : Number(stepText);
    if (step < 1) return null;
    let from: number | null;
    let to: number | null;
    if (range === "*") {
      from = field.min;
      to = field.max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      from = parseValue(a, field);
      to = parseValue(b, field);
    } else {
      from = parseValue(range, field);
      // "5/15" means from 5 to the end, every 15.
      to = stepText == null ? from : field.max;
    }
    if (from == null || to == null || from < field.min || to > field.max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

/** Parses a five-field cron expression (or an @macro); null if it isn't one. */
export function parseCron(expression: string): CronSpec | null {
  const trimmed = expression.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_CRON_LENGTH) return null;
  const fields = (MACROS[trimmed] ?? trimmed).split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteText, hourText, domText, monthText, dowText] = fields;
  const minutes = parseField(minuteText, MINUTE);
  const hours = parseField(hourText, HOUR);
  const daysOfMonth = parseField(domText, DAY_OF_MONTH);
  const months = parseField(monthText, MONTH);
  const daysOfWeek = parseField(dowText, DAY_OF_WEEK);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return {
    minutes,
    hours,
    daysOfMonth: new Set(daysOfMonth),
    months: new Set(months),
    daysOfWeek: new Set(daysOfWeek.map((day) => day % 7)),
    eitherDay: !domText.startsWith("*") && !dowText.startsWith("*"),
  };
}

function dayMatches(spec: CronSpec, day: string): boolean {
  const [, month, date] = day.split("-").map(Number);
  if (!spec.months.has(month)) return false;
  const byDate = spec.daysOfMonth.has(date);
  const byWeekday = spec.daysOfWeek.has(weekday(day));
  return spec.eitherDay ? byDate || byWeekday : byDate && byWeekday;
}

/** How far ahead to look; "0 0 29 2 *" (Feb 29th) can be eight years away. */
const SEARCH_DAYS = 366 * 8;

/**
 * The first time after `after` the expression matches, on the wall clock of
 * `timeZone`; null if it never does. Matching is by wall time, so when clocks go
 * back the repeated hour fires once, and a time skipped when they go forward
 * fires right after the change.
 */
export function nextCronTime(spec: CronSpec, after: Date, timeZone: string): Date | null {
  const start = wallClock(after, timeZone);
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const day = addDays(start.day, offset);
    if (!dayMatches(spec, day)) continue;
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        const minutes = hour * 60 + minute;
        if (offset === 0 && minutes <= start.minutes) continue;
        const instant = zonedInstant(day, minutes, timeZone);
        if (instant > after) return instant;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schedules

function timeToCron(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour}`;
}

/** Every schedule is a cron expression underneath. */
export function scheduleToCron(schedule: RoutineSchedule): string {
  switch (schedule.kind) {
    case "daily":
      return `${timeToCron(schedule.time)} * * *`;
    case "weekly":
      return `${timeToCron(schedule.time)} * * ${[...schedule.days].sort((a, b) => a - b).join(",")}`;
    case "cron":
      return schedule.expression.trim();
  }
}

/** When the routine is next due after `after`; null for a schedule that never comes due. */
export function nextRunAt(schedule: RoutineSchedule, after: Date, timeZone: string): Date | null {
  const spec = parseCron(scheduleToCron(schedule));
  return spec ? nextCronTime(spec, after, timeZone) : null;
}

const time = z.string().regex(TIME, "errors.timeInvalid");

/** Validates a schedule from the form; messages are dictionary keys. */
export const routineScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time }),
  z.object({
    kind: z.literal("weekly"),
    time,
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1, "errors.weekdaysRequired")
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  }),
  z.object({
    kind: z.literal("cron"),
    expression: z
      .string()
      .trim()
      .superRefine((expression, ctx) => {
        const spec = parseCron(expression);
        if (!spec) ctx.addIssue({ code: "custom", message: "errors.cronInvalid" });
        else if (spec.minutes.length > MAX_FIRINGS_PER_HOUR) ctx.addIssue({ code: "custom", message: "errors.cronTooFrequent" });
        // Feb 30th and the like parse fine and never come due.
        else if (!nextCronTime(spec, new Date(), "UTC")) ctx.addIssue({ code: "custom", message: "errors.cronNeverDue" });
      }),
  }),
]);

/** A schedule read back from the database; anything unreadable counts as none. */
export function parseSchedule(raw: unknown): RoutineSchedule | null {
  const parsed = routineScheduleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
