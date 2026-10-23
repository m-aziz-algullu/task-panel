import { describe, expect, it } from "vitest";
import {
  gatewayHeaders,
  isSameOrigin,
  publicLocation,
  routeFor,
  sessionChecker,
  sessionToken,
  withoutSessionCookie,
} from "../docker/control-ui-proxy.mjs";

const GATEWAY = "127.0.0.1:18789";

describe("routeFor", () => {
  it("sends the Control UI and the Gateway's endpoints to the Gateway", () => {
    expect(routeFor("/openclaw")).toBe("gateway");
    expect(routeFor("/openclaw/settings?tab=1")).toBe("gateway");
    expect(routeFor("/__openclaw__/assistant-media?meta=1")).toBe("gateway");
  });

  it("leaves everything else to Task Panel", () => {
    expect(routeFor("/")).toBe("app");
    expect(routeFor("/tr/agent")).toBe("app");
    expect(routeFor("/openclaw-notes")).toBe("app");
    expect(routeFor("/api/agent/control-ui")).toBe("app");
  });
});

describe("session cookie", () => {
  it("finds the session token among other cookies", () => {
    expect(sessionToken("theme=dark; tp_session=abc.def; lang=tr")).toBe("abc.def");
    expect(sessionToken("theme=dark")).toBeNull();
    expect(sessionToken(undefined)).toBeNull();
    expect(sessionToken("tp_session=")).toBeNull();
  });

  it("keeps it from the Gateway", () => {
    expect(withoutSessionCookie("theme=dark; tp_session=abc; lang=tr")).toBe("theme=dark; lang=tr");
    expect(withoutSessionCookie("tp_session=abc")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  it("accepts pages on the same host, directly or behind a reverse proxy", () => {
    expect(isSameOrigin({ origin: "https://panel.example.com", host: "panel.example.com" })).toBe(true);
    expect(
      isSameOrigin({ origin: "https://panel.example.com", host: "app:3000", "x-forwarded-host": "panel.example.com" }),
    ).toBe(true);
  });

  it("refuses other sites and missing origins", () => {
    expect(isSameOrigin({ origin: "https://evil.example", host: "panel.example.com" })).toBe(false);
    expect(isSameOrigin({ host: "panel.example.com" })).toBe(false);
    expect(isSameOrigin({ origin: "null", host: "panel.example.com" })).toBe(false);
  });
});

describe("gatewayHeaders", () => {
  it("makes the request look local to the Gateway", () => {
    const pairs = gatewayHeaders(
      [
        "Host", "panel.example.com",
        "Origin", "https://panel.example.com",
        "X-Forwarded-For", "203.0.113.5",
        "X-Forwarded-Proto", "https",
        "X-Real-IP", "203.0.113.5",
        "Forwarded", "for=203.0.113.5",
        "Cookie", "tp_session=abc; theme=dark",
        "Sec-WebSocket-Key", "k",
      ],
      GATEWAY,
    );
    expect(pairs).toEqual([
      "Host", GATEWAY,
      "Origin", `http://${GATEWAY}`,
      "Cookie", "theme=dark",
      "Sec-WebSocket-Key", "k",
    ]);
  });
});

describe("publicLocation", () => {
  it("turns the Gateway's own redirects into paths on this site", () => {
    expect(publicLocation(`http://${GATEWAY}/openclaw/chat`, GATEWAY)).toBe("/openclaw/chat");
    expect(publicLocation("/openclaw/", GATEWAY)).toBe("/openclaw/");
    expect(publicLocation("https://example.com/x", GATEWAY)).toBe("https://example.com/x");
  });
});

describe("sessionChecker", () => {
  it("asks the app once per token for a while, and never for a missing token", async () => {
    let calls = 0;
    let time = 0;
    const check = sessionChecker(async (token: string) => {
      calls++;
      return token === "good";
    }, () => time);

    expect(await check(null)).toBe(false);
    expect(calls).toBe(0);
    expect(await check("good")).toBe(true);
    expect(await check("good")).toBe(true);
    expect(calls).toBe(1);
    time += 31_000;
    expect(await check("good")).toBe(true);
    expect(calls).toBe(2);
    expect(await check("bad")).toBe(false);
    expect(await check("bad")).toBe(false);
    expect(calls).toBe(4);
  });
});
