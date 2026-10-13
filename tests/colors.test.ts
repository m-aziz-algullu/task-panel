import { describe, expect, it } from "vitest";
import { isHexColor, readableTextColor } from "@/lib/colors";

describe("readableTextColor", () => {
  it("uses dark text on light colors and white on mid and dark colors", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#eab308")).toBe("#000000");
    expect(readableTextColor("#0f172a")).toBe("#ffffff");
    expect(readableTextColor("#6366f1")).toBe("#ffffff");
    expect(readableTextColor("#3b82f6")).toBe("#ffffff");
    expect(readableTextColor("#22c55e")).toBe("#000000");
  });
});

describe("isHexColor", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#A855f7")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });
});
