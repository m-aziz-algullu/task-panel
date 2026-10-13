import { describe, expect, it } from "vitest";
import { placeInColumn } from "@/lib/ordering";

describe("placeInColumn", () => {
  it("reorders within a fully visible column", () => {
    expect(placeInColumn([1, 2, 3], [2, 1, 3], 2)).toEqual([2, 1, 3]);
    expect(placeInColumn([1, 2, 3], [1, 3, 2], 2)).toEqual([1, 3, 2]);
  });

  it("inserts a task coming from another column", () => {
    expect(placeInColumn([1, 2], [1, 9, 2], 9)).toEqual([1, 9, 2]);
    expect(placeInColumn([], [9], 9)).toEqual([9]);
  });

  it("keeps hidden tasks in place when a filter is active", () => {
    // Column is 1,2,3,4; only 1 and 4 are visible. Dropping 9 between them puts it right after 1.
    expect(placeInColumn([1, 2, 3, 4], [1, 9, 4], 9)).toEqual([1, 9, 2, 3, 4]);
    // Dropped first among visible tasks: goes right before the first visible one.
    expect(placeInColumn([1, 2, 3, 4], [9, 3], 9)).toEqual([1, 2, 9, 3, 4]);
  });
});
