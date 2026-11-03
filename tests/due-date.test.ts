import { describe, expect, it } from "vitest";
import { daysUntil } from "@/lib/dates";
import { DUE_SOON_DAYS, dueAlert } from "@/lib/due-date";

const today = "2026-11-03";

describe("daysUntil", () => {
  it("counts whole days, across months and backwards", () => {
    expect(daysUntil(today, today)).toBe(0);
    expect(daysUntil("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysUntil(today, "2026-11-01")).toBe(-2);
  });

  it("ignores DST, since days are calendar keys", () => {
    expect(daysUntil("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("dueAlert", () => {
  const open = (dueDate: string) => ({ status: "in_progress" as const, dueDate });

  it("stays dark while the deadline is far off", () => {
    expect(dueAlert(open("2026-11-06"), today)).toBeNull();
  });

  it(`lights up from ${DUE_SOON_DAYS} days before the due date`, () => {
    expect(dueAlert(open("2026-11-05"), today)).toEqual({ kind: "soon", daysLeft: 2 });
    expect(dueAlert(open("2026-11-04"), today)).toEqual({ kind: "soon", daysLeft: 1 });
    expect(dueAlert(open(today), today)).toEqual({ kind: "soon", daysLeft: 0 });
  });

  it("stays lit once the due date has passed", () => {
    expect(dueAlert(open("2026-10-31"), today)).toEqual({ kind: "overdue", daysLate: 3 });
  });

  it("never lights a done task", () => {
    expect(dueAlert({ status: "done", dueDate: today }, today)).toBeNull();
    expect(dueAlert({ status: "done", dueDate: "2026-10-01" }, today)).toBeNull();
  });

  it("lights any status that isn't done", () => {
    for (const status of ["backlog", "in_progress", "pending"] as const) {
      expect(dueAlert({ status, dueDate: today }, today)?.kind).toBe("soon");
    }
  });
});
