import { describe, expect, it } from "vitest";
import { hashPassword, newSessionToken, normalizeEmail, sessionIdFromToken, verifyPassword } from "@/lib/auth";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("doğru-şifre-123");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("doğru-şifre-123", stored)).toBe(true);
    expect(await verifyPassword("Doğru-şifre-123", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are random and stored only as a hash", () => {
    const a = newSessionToken();
    expect(a).not.toBe(newSessionToken());
    expect(sessionIdFromToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionIdFromToken(a)).toBe(sessionIdFromToken(a));
    expect(sessionIdFromToken(a)).not.toContain(a);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Mehmet@Example.COM ")).toBe("mehmet@example.com");
  });
});
