// Web Push: the pure rules (subscription validation, how push service answers
// are treated, backoff, notification text).
import { describe, expect, it } from "vitest";
import { systemCommentBody } from "@/lib/agent/system-comments";
import { notifiesRunEnd, pushLocale, runEndMessage, testMessage } from "@/lib/push/notification";
import {
  MAX_PUSH_ATTEMPTS,
  base64UrlBytes,
  bytesToBase64Url,
  classifyPushResponse,
  deviceLabel,
  excerpt,
  parseRetryAfter,
  pushSubscriptionSchema,
  retryDelayMs,
  vapidPublicKeySchema,
} from "@/lib/push/shape";
import { RUN_STATUSES } from "@/lib/types";
import { browserKeys } from "./push-service";

const subscription = () => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  expirationTime: null,
  keys: browserKeys().keys,
});

describe("base64url", () => {
  it("round-trips bytes without padding", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const text = bytesToBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlBytes(text)).toEqual(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64url"));
  });

  it("accepts padding and rejects other alphabets", () => {
    expect(base64UrlBytes("AQ==")).toEqual(Uint8Array.of(1));
    expect(base64UrlBytes("a+b/")).toBeNull();
    expect(base64UrlBytes("abcde")).toBeNull();
  });
});

describe("pushSubscriptionSchema", () => {
  it("accepts what PushSubscription.toJSON() returns", () => {
    expect(pushSubscriptionSchema.safeParse(subscription()).success).toBe(true);
  });

  it("only takes https endpoints without credentials", () => {
    for (const endpoint of ["http://push.example.com/x", "javascript:alert(1)", "not a url", "https://u:p@push.example.com/x"]) {
      expect(pushSubscriptionSchema.safeParse({ ...subscription(), endpoint }).success, endpoint).toBe(false);
    }
  });

  it("rejects keys of the wrong size or shape", () => {
    const valid = subscription();
    const shortKey = Buffer.alloc(33, 4).toString("base64url");
    const compressed = Buffer.concat([Buffer.of(2), Buffer.alloc(64, 1)]).toString("base64url");
    expect(pushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, p256dh: shortKey } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, p256dh: compressed } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, auth: "AAAA" } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false);
  });

  it("validates a VAPID public key the same way", () => {
    expect(vapidPublicKeySchema.safeParse(subscription().keys.p256dh).success).toBe(true);
    expect(vapidPublicKeySchema.safeParse("abc").success).toBe(false);
  });
});

describe("classifyPushResponse", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");

  it("treats 2xx as delivered", () => {
    expect(classifyPushResponse(201, "")).toEqual({ kind: "delivered" });
    expect(classifyPushResponse(200, "")).toEqual({ kind: "delivered" });
  });

  it("forgets subscriptions the service says are gone", () => {
    expect(classifyPushResponse(404, "")).toMatchObject({ kind: "gone", error: "HTTP 404" });
    expect(classifyPushResponse(410, "expired")).toMatchObject({ kind: "gone", error: "HTTP 410: expired" });
  });

  it("retries throttling and server errors, honouring Retry-After", () => {
    expect(classifyPushResponse(429, "", "120", now)).toEqual({ kind: "retry", error: "HTTP 429", retryAfterMs: 120_000 });
    expect(classifyPushResponse(503, "", "Mon, 23 Nov 2026 12:05:00 GMT", now)).toMatchObject({
      kind: "retry",
      retryAfterMs: 300_000,
    });
    expect(classifyPushResponse(500, "oops")).toEqual({ kind: "retry", error: "HTTP 500: oops" });
    expect(classifyPushResponse(408, "")).toMatchObject({ kind: "retry" });
  });

  it("gives up on refusals that a retry won't fix", () => {
    for (const status of [400, 401, 403, 413]) expect(classifyPushResponse(status, "").kind).toBe("rejected");
  });

  it("keeps the error short", () => {
    const outcome = classifyPushResponse(400, "x".repeat(1000));
    expect(outcome.kind === "rejected" && outcome.error.length).toBeLessThan(220);
  });

  it("parses Retry-After in both forms", () => {
    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter("Mon, 23 Nov 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially from 30 seconds up to an hour", () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(MAX_PUSH_ATTEMPTS + 20)).toBe(3_600_000);
  });

  it("waits at least what the service asked, within the cap", () => {
    expect(retryDelayMs(1, 600_000)).toBe(600_000);
    expect(retryDelayMs(1, 10_000)).toBe(30_000);
    expect(retryDelayMs(1, 86_400_000)).toBe(3_600_000);
  });
});

describe("excerpt", () => {
  it("turns markdown into one line of plain text", () => {
    const report = "## Done\n\n- Fixed **the bug** in `parser.ts`\n- See [the PR](https://example.com/1)\n\n```ts\nconst x = 1;\n```\nAll _good_.";
    expect(excerpt(report)).toBe("Done Fixed the bug in parser.ts See the PR All good.");
  });

  it("cuts long text with an ellipsis", () => {
    const text = excerpt("word ".repeat(100), 50);
    expect(text.length).toBeLessThanOrEqual(50);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("deviceLabel", () => {
  it("names common browsers and systems", () => {
    expect(
      deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    ).toBe("Chrome · macOS");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe(
      "iOS",
    );
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox · Linux");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe(
      "Edge · Windows",
    );
    expect(deviceLabel(null)).toBe("Browser");
  });
});

describe("run notifications", () => {
  const task = { id: 42, title: "Write the report" };

  it("notifies every ending except the user's own stop", () => {
    expect(RUN_STATUSES.filter(notifiesRunEnd)).toEqual(["done", "blocked", "failed", "timed_out", "budget_exceeded"]);
  });

  it("says the agent finished, with the start of its report", () => {
    const message = runEndMessage({ status: "done", task, comment: { author: "agent", body: "**All done.** Tests pass." } }, "en");
    expect(message).toEqual({
      payload: {
        title: "Agent finished: Write the report",
        body: "All done. Tests pass.",
        url: "/en?task=42",
        tag: "task-42",
      },
      topic: "task-42",
    });
  });

  it("says the agent needs you, in the device's language, with the app's reason", () => {
    const comment = { author: "system" as const, body: systemCommentBody("agentRun.systemTimedOut", { minutes: 30 }) };
    const message = runEndMessage({ status: "timed_out", task, comment }, "tr")!;
    expect(message.payload.title).toBe("Ajan seni bekliyor: Write the report");
    expect(message.payload.body).toContain("30");
    expect(message.payload.body).not.toContain("agentRun.");
    expect(message.payload.url).toBe("/tr?task=42");
  });

  it("falls back to a plain sentence without a comment", () => {
    expect(runEndMessage({ status: "blocked", task }, "en")!.payload.body).toBe("Task #42 stopped and is waiting for you.");
    expect(runEndMessage({ status: "done", task, comment: null }, "tr")!.payload.body).toBe("#42 numaralı görev incelemene hazır.");
  });

  it("sends nothing for an aborted run", () => {
    expect(runEndMessage({ status: "aborted", task }, "en")).toBeNull();
  });

  it("keeps a long title short", () => {
    const message = runEndMessage({ status: "done", task: { id: 1, title: "x".repeat(300) } }, "en")!;
    expect(message.payload.title.length).toBeLessThanOrEqual(120);
  });

  it("uses English for an unknown language", () => {
    expect(pushLocale("de")).toBe("en");
    expect(testMessage("??").payload).toMatchObject({ title: "Task Panel", url: "/en/settings" });
  });
});
