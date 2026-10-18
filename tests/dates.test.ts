import { describe, expect, it } from "vitest";
import { addDays, dayKey, daysBetweenDesc, formatDay, formatLongDay, isDayKey, startOfDay } from "@/lib/dates";

describe("dayKey", () => {
  it("uses the given time zone, not UTC", () => {
    // 22:30 UTC is already the next day in Istanbul (UTC+3).
    const instant = new Date("2026-10-13T22:30:00Z");
    expect(dayKey(instant, "Europe/Istanbul")).toBe("2026-10-14");
    expect(dayKey(instant, "UTC")).toBe("2026-10-13");
  });
});

describe("startOfDay", () => {
  it("returns local midnight in Istanbul", () => {
    expect(startOfDay("2026-10-14", "Europe/Istanbul").toISOString()).toBe("2026-10-13T21:00:00.000Z");
  });

  it("handles DST changes", () => {
    // Berlin switches to CEST on 2026-03-29; midnight that day is still CET (UTC+1).
    expect(startOfDay("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfDay("2026-03-30", "Europe/Berlin").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("daysBetweenDesc", () => {
  it("lists every day newest first, across month boundaries", () => {
    expect(daysBetweenDesc("2026-02-27", "2026-03-02")).toEqual(["2026-03-02", "2026-03-01", "2026-02-28", "2026-02-27"]);
  });

  it("handles a single day and an inverted range", () => {
    expect(daysBetweenDesc("2026-10-14", "2026-10-14")).toEqual(["2026-10-14"]);
    expect(daysBetweenDesc("2026-10-15", "2026-10-14")).toEqual([]);
  });
});

describe("isDayKey", () => {
  it("rejects malformed and impossible dates", () => {
    expect(isDayKey("2026-10-13")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("13.10.2026")).toBe(false);
  });
});

describe("formatDay", () => {
  const tr = { today: "Bugün", tomorrow: "Yarın", yesterday: "Dün" };
  const en = { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" };

  it("names nearby days relative to today", () => {
    expect(formatDay("2026-10-13", "2026-10-13", tr, "tr-TR")).toBe("Bugün");
    expect(formatDay("2026-10-14", "2026-10-13", tr, "tr-TR")).toBe("Yarın");
    expect(formatDay("2026-10-12", "2026-10-13", en, "en-US")).toBe("Yesterday");
  });

  it("formats other days in the given locale", () => {
    expect(formatDay("2026-10-20", "2026-10-13", tr, "tr-TR")).toMatch(/20 Eki/);
    expect(formatDay("2026-10-20", "2026-10-13", en, "en-US")).toMatch(/Oct 20/);
  });
});

describe("formatLongDay", () => {
  it("spells out the date in the given locale", () => {
    expect(formatLongDay("2026-10-13", "tr-TR")).toMatch(/13 Ekim 2026/);
    expect(formatLongDay("2026-10-13", "en-US")).toMatch(/October 13, 2026/);
  });
});
