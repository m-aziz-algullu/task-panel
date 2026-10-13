import { describe, expect, it } from "vitest";
import { generateSetupCode, normalizeSetupCode, setupCodeMatches } from "@/lib/setup-code";

describe("setup code", () => {
  it("looks like XXXX-XXXX-XXXX-XXXX without ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSetupCode();
      expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("is random", () => {
    expect(new Set(Array.from({ length: 20 }, generateSetupCode)).size).toBe(20);
  });

  it("accepts the code typed loosely", () => {
    const code = "K7PQ-3XMA-9WRT-H2CD";
    expect(normalizeSetupCode(" k7pq 3xma-9wrt-h2cd ")).toBe("K7PQ3XMA9WRTH2CD");
    expect(setupCodeMatches(code, code)).toBe(true);
    expect(setupCodeMatches("k7pq3xma9wrth2cd", code)).toBe(true);
  });

  it("rejects wrong, partial and empty codes", () => {
    const code = "K7PQ-3XMA-9WRT-H2CD";
    expect(setupCodeMatches("K7PQ-3XMA-9WRT-H2CE", code)).toBe(false);
    expect(setupCodeMatches("K7PQ-3XMA", code)).toBe(false);
    expect(setupCodeMatches("", code)).toBe(false);
    expect(setupCodeMatches("", "")).toBe(false);
  });
});
