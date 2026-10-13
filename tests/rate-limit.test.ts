import { describe, expect, it } from "vitest";
import { clientIpFrom, exceeded, minutesUntil, signInLimits } from "@/lib/rate-limit-rules";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("clientIpFrom", () => {
  it("prefers the proxy's X-Real-Ip, then the first X-Forwarded-For entry", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIpFrom(headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.2" }))).toBe("198.51.100.1");
    expect(clientIpFrom(headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("falls back to a shared bucket for missing or junk values", () => {
    expect(clientIpFrom(headers({}))).toBe("unknown");
    expect(clientIpFrom(headers({ "x-real-ip": "<script>" }))).toBe("unknown");
    expect(clientIpFrom(headers({ "x-real-ip": "1".repeat(100) }))).toBe("unknown");
  });
});

describe("exceeded", () => {
  const limits = signInLimits("203.0.113.7", "me@example.com");

  it("allows up to max attempts per key", () => {
    expect(exceeded(limits, new Map([["ip:203.0.113.7", 10]]))).toEqual([]);
  });

  it("blocks once an IP or an account goes over", () => {
    expect(exceeded(limits, new Map([["ip:203.0.113.7", 11]])).map((l) => l.key)).toEqual(["ip:203.0.113.7"]);
    expect(exceeded(limits, new Map([["account:me@example.com", 51]])).map((l) => l.key)).toEqual([
      "account:me@example.com",
    ]);
  });
});

describe("minutesUntil", () => {
  it("rounds up and never says zero", () => {
    expect(minutesUntil(0)).toBe(1);
    expect(minutesUntil(61)).toBe(2);
    expect(minutesUntil(900)).toBe(15);
  });
});
