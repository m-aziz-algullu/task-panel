import { describe, expect, it } from "vitest";
import { closesOnPress, DEFAULT_DISMISSAL, TASK_DIALOG_DISMISSAL } from "@/components/modal-dismiss";

const dialog = new EventTarget();
const content = new EventTarget();

describe("closesOnPress", () => {
  it("closes a default modal on a backdrop press", () => {
    expect(closesOnPress(dialog, dialog, DEFAULT_DISMISSAL)).toBe(true);
  });

  it("never closes on a press inside the content", () => {
    expect(closesOnPress(content, dialog, DEFAULT_DISMISSAL)).toBe(false);
    expect(closesOnPress(content, dialog, TASK_DIALOG_DISMISSAL)).toBe(false);
  });

  it("keeps the task dialog open on a backdrop press", () => {
    expect(closesOnPress(dialog, dialog, TASK_DIALOG_DISMISSAL)).toBe(false);
  });

  it("ignores a press before the dialog is mounted", () => {
    expect(closesOnPress(null, null, DEFAULT_DISMISSAL)).toBe(false);
  });
});
