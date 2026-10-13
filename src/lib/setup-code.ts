import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// One-time setup code that guards the first (admin) sign-up. Pure helpers; the
// database side lives in ./setup.ts.

// No 0/O, 1/I/L: easy to copy from a log by eye.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** e.g. "K7PQ-3XMA-9WRT-H2CD" (16 chars from 31 symbols, ~79 bits). */
export function generateSetupCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return groups.join("-");
}

/** Ignores case, spaces and dashes so a pasted or retyped code still matches. */
export function normalizeSetupCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function setupCodeMatches(input: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const digest = (value: string) => createHash("sha256").update(normalizeSetupCode(value)).digest();
  return normalizeSetupCode(expected).length > 0 && timingSafeEqual(digest(input), digest(expected));
}
