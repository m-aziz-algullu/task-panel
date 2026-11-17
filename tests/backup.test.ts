import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_VERSION, backupFileName, parseBackup, summarizeBackup } from "@/lib/backup-shape";

const at = "2026-11-17T10:00:00.000Z";

function backup(data: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: at,
    ...header,
    data: {
      tags: [{ id: 3, name: "work", color: "#2563eb", createdAt: at }],
      tasks: [
        {
          id: 7,
          title: "Write the report",
          descriptionDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
          status: "done",
          storyPoints: 3,
          day: "2026-11-16",
          dueDate: "2026-11-20",
          position: 1.5,
          createdAt: at,
          updatedAt: at,
          completedAt: at,
          tagIds: [3],
          comments: [{ author: "agent", body: "Done.", createdAt: at }],
        },
      ],
      routines: [
        {
          id: 2,
          title: "Weekly review",
          body: "- check the board",
          schedule: { kind: "weekly", time: "09:00", days: [5, 1] },
          handToAgent: false,
          lastRunAt: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
      agentSettings: { concurrency: 2, autoTagId: 3 },
      ...data,
    },
  };
}

describe("parseBackup", () => {
  it("accepts a backup and normalizes routine schedules", () => {
    const parsed = parseBackup(backup());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.routines[0].schedule).toEqual({ kind: "weekly", time: "09:00", days: [1, 5] });
    expect(summarizeBackup(parsed.backup)).toEqual({ exportedAt: at, tags: 1, tasks: 1, routines: 1 });
  });

  it("accepts an empty board", () => {
    expect(parseBackup(backup({ tags: [], tasks: [], routines: [], agentSettings: null })).ok).toBe(true);
  });

  it("survives a JSON round trip", () => {
    expect(parseBackup(JSON.parse(JSON.stringify(backup()))).ok).toBe(true);
  });

  it("rejects anything that isn't a Task Panel backup", () => {
    for (const raw of [null, "text", [], {}, { format: "other", version: 1 }]) {
      expect(parseBackup(raw)).toMatchObject({ ok: false, error: "errors.backupInvalid" });
    }
  });

  it("tells a newer backup apart from a broken one", () => {
    expect(parseBackup(backup({}, { version: BACKUP_VERSION + 1 }))).toEqual({ ok: false, error: "errors.backupNewer" });
  });

  it("rejects rows the panel itself would refuse", () => {
    const task = backup().data.tasks[0];
    const cases = [
      { tasks: [{ ...task, status: "archived" }] },
      { tasks: [{ ...task, title: " " }] },
      { tasks: [{ ...task, dueDate: "2026-02-30" }] },
      { tasks: [{ ...task, comments: [{ author: "someone", body: "x", createdAt: at }] }] },
      { tags: [{ id: 3, name: "work", color: "blue", createdAt: at }] },
    ];
    for (const data of cases) expect(parseBackup(backup(data))).toMatchObject({ ok: false, error: "errors.backupInvalid" });
  });

  it("rejects broken references and duplicates", () => {
    const { tags, tasks } = backup().data;
    const cases = [
      { tasks: [{ ...tasks[0], tagIds: [99] }] },
      { tasks: [tasks[0], tasks[0]] },
      { tags: [tags[0], { ...tags[0], id: 4 }] },
      { tags: [tags[0], { ...tags[0], name: "other" }] },
    ];
    for (const data of cases) {
      const parsed = parseBackup(backup(data));
      expect(parsed).toMatchObject({ ok: false, error: "errors.backupInvalid" });
    }
  });
});

describe("backupFileName", () => {
  it("names the file after the day", () => {
    expect(backupFileName("2026-11-17")).toBe("task-panel-backup-2026-11-17.json");
  });
});
