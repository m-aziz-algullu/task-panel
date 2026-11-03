import { describe, expect, it } from "vitest";
import { wallClock, zonedInstant } from "@/lib/dates";
import {
  nextRunAt,
  parseCron,
  parseSchedule,
  routineScheduleSchema,
  scheduleToCron,
  type RoutineSchedule,
} from "@/lib/routine-schedule";

const IST = "Europe/Istanbul";
const at = (iso: string) => new Date(iso);
const next = (schedule: RoutineSchedule, after: string, timeZone = IST) =>
  nextRunAt(schedule, at(after), timeZone)?.toISOString() ?? null;

describe("parseCron", () => {
  it("reads lists, ranges, steps and names", () => {
    const spec = parseCron("0,30 8-10/2 1,15 jan-mar MON-fri")!;
    expect(spec.minutes).toEqual([0, 30]);
    expect(spec.hours).toEqual([8, 10]);
    expect([...spec.daysOfMonth]).toEqual([1, 15]);
    expect([...spec.months]).toEqual([1, 2, 3]);
    expect([...spec.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(spec.eitherDay).toBe(true);
  });

  it("treats 7 as Sunday and expands macros", () => {
    expect([...parseCron("0 0 * * 7")!.daysOfWeek]).toEqual([0]);
    expect(parseCron("@daily")).toEqual(parseCron("0 0 * * *"));
    expect(parseCron("*/15 * * * *")!.minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron("5/20 * * * *")!.minutes).toEqual([5, 25, 45]);
  });

  it("rejects malformed expressions", () => {
    for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "5-1 * * * *", "*/0 * * * *", "a b c d e", "@reboot"]) {
      expect(parseCron(bad), bad).toBeNull();
    }
  });
});

describe("nextRunAt", () => {
  it("fires daily at the wall-clock time of the app time zone", () => {
    // 08:00 in Istanbul (UTC+3) is 05:00 UTC.
    expect(next({ kind: "daily", time: "08:00" }, "2026-11-03T04:00:00Z")).toBe("2026-11-03T05:00:00.000Z");
    expect(next({ kind: "daily", time: "08:00" }, "2026-11-03T05:00:00Z")).toBe("2026-11-04T05:00:00.000Z");
    expect(next({ kind: "daily", time: "08:00" }, "2026-11-03T05:00:30Z")).toBe("2026-11-04T05:00:00.000Z");
  });

  it("fires weekly on the chosen days only", () => {
    // 2026-11-03 is a Tuesday.
    const schedule: RoutineSchedule = { kind: "weekly", time: "07:30", days: [1, 5] };
    expect(next(schedule, "2026-11-03T10:00:00Z")).toBe("2026-11-06T04:30:00.000Z");
    expect(next(schedule, "2026-11-06T04:30:00Z")).toBe("2026-11-09T04:30:00.000Z");
  });

  it("matches either day field when both are restricted", () => {
    // The 1st of the month or any Friday.
    const schedule: RoutineSchedule = { kind: "cron", expression: "0 9 1 * 5" };
    expect(next(schedule, "2026-11-03T00:00:00Z", "UTC")).toBe("2026-11-06T09:00:00.000Z");
    expect(next(schedule, "2026-11-27T10:00:00Z", "UTC")).toBe("2026-12-01T09:00:00.000Z");
  });

  it("finds rare dates", () => {
    expect(next({ kind: "cron", expression: "0 0 29 2 *" }, "2026-11-03T00:00:00Z", "UTC")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expect(next({ kind: "cron", expression: "0 0 31 2 *" }, "2026-11-03T00:00:00Z", "UTC")).toBeNull();
  });

  it("fires once when clocks go back", () => {
    // Berlin returns from CEST to CET at 03:00 on 2026-10-25; 02:30 happens twice.
    const schedule: RoutineSchedule = { kind: "daily", time: "02:30" };
    const first = nextRunAt(schedule, at("2026-10-24T12:00:00Z"), "Europe/Berlin")!;
    expect(wallClock(first, "Europe/Berlin")).toEqual({ day: "2026-10-25", minutes: 150 });
    const second = nextRunAt(schedule, first, "Europe/Berlin")!;
    expect(wallClock(second, "Europe/Berlin").day).toBe("2026-10-26");
  });

  it("fires right after a time that clocks skip", () => {
    // Berlin jumps from 02:00 to 03:00 on 2026-03-29; 02:30 doesn't exist that day.
    const fired = nextRunAt({ kind: "daily", time: "02:30" }, at("2026-03-28T12:00:00Z"), "Europe/Berlin")!;
    expect(fired.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(nextRunAt({ kind: "daily", time: "02:30" }, fired, "Europe/Berlin")!.toISOString()).toBe(
      "2026-03-30T00:30:00.000Z",
    );
  });

  it("always moves forward", () => {
    let after = at("2026-11-03T00:00:00Z");
    for (let i = 0; i < 50; i++) {
      const fired = nextRunAt({ kind: "cron", expression: "*/15 9-10 * * 1-5" }, after, IST)!;
      expect(fired.getTime()).toBeGreaterThan(after.getTime());
      after = fired;
    }
  });
});

describe("scheduleToCron", () => {
  it("turns daily and weekly schedules into expressions", () => {
    expect(scheduleToCron({ kind: "daily", time: "08:05" })).toBe("5 8 * * *");
    expect(scheduleToCron({ kind: "weekly", time: "18:00", days: [5, 1] })).toBe("0 18 * * 1,5");
  });
});

describe("routineScheduleSchema", () => {
  const error = (value: unknown) => routineScheduleSchema.safeParse(value).error?.issues[0]?.message;

  it("accepts and normalizes valid schedules", () => {
    expect(routineScheduleSchema.parse({ kind: "weekly", time: "07:00", days: [5, 1, 5] })).toEqual({
      kind: "weekly",
      time: "07:00",
      days: [1, 5],
    });
    expect(routineScheduleSchema.parse({ kind: "cron", expression: "  0 8 * * 1-5 " })).toEqual({
      kind: "cron",
      expression: "0 8 * * 1-5",
    });
  });

  it("rejects bad input with dictionary keys", () => {
    expect(error({ kind: "daily", time: "24:00" })).toBe("errors.timeInvalid");
    expect(error({ kind: "weekly", time: "08:00", days: [] })).toBe("errors.weekdaysRequired");
    expect(error({ kind: "cron", expression: "nope" })).toBe("errors.cronInvalid");
    expect(error({ kind: "cron", expression: "* 8 * * *" })).toBe("errors.cronTooFrequent");
    expect(error({ kind: "cron", expression: "0 0 30 2 *" })).toBe("errors.cronNeverDue");
  });

  it("reads anything unreadable from the database as no schedule", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule({ kind: "hourly" })).toBeNull();
    expect(parseSchedule({ kind: "daily", time: "06:15" })).toEqual({ kind: "daily", time: "06:15" });
  });
});

describe("zonedInstant", () => {
  it("is the inverse of wallClock", () => {
    const instant = zonedInstant("2026-11-03", 8 * 60 + 45, IST);
    expect(instant.toISOString()).toBe("2026-11-03T05:45:00.000Z");
    expect(wallClock(instant, IST)).toEqual({ day: "2026-11-03", minutes: 525 });
  });
});
