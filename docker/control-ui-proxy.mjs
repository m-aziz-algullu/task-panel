// Front door of the agent image: listens on the public port and passes every
// request to the Next.js server, except OpenClaw's Control UI (under
// CONTROL_UI_BASE_PATH) and every WebSocket, which go to the Gateway once the
// request carries a valid Task Panel session.
//
// To the Gateway those requests look like a browser on its own loopback: no
// forwarded headers, Host and Origin set to its address. That is what lets the
// Control UI accept the origin and pair the browser without a manual approval;
// the Task Panel session and the same-origin check here stand in for both.

import http from "node:http";
import net from "node:net";

export const CONTROL_UI_BASE_PATH = "/openclaw";
/** The Gateway's own HTTP endpoints (avatars, media), outside the Control UI base path. */
const GATEWAY_PREFIXES = [CONTROL_UI_BASE_PATH, "/__openclaw__"];
const SESSION_COOKIE = "tp_session";
/** How long a confirmed session is trusted without asking the app again. */
const SESSION_CACHE_MS = 30_000;
const SESSION_CACHE_MAX = 100;

/** "gateway" for the Control UI and the Gateway's endpoints, "app" for everything else. */
export function routeFor(url) {
  const pathname = (url ?? "/").split("?")[0];
  return GATEWAY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ? "gateway" : "app";
}

/** The Task Panel session token in a Cookie header, or null. */
export function sessionToken(cookieHeader) {
  for (const part of (cookieHeader ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === SESSION_COOKIE) return part.slice(index + 1).trim() || null;
  }
  return null;
}

/** The Cookie header without Task Panel's session, which the Gateway has no use for; null when nothing is left. */
export function withoutSessionCookie(cookieHeader) {
  const kept = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part.split("=")[0].trim() !== SESSION_COOKIE);
  return kept.length ? kept.join("; ") : null;
}

/**
 * Whether a WebSocket handshake comes from a page on this site, so another site
 * can't open the Gateway with the visitor's cookie. Compares the Origin's host
 * with the Host header (or, behind a reverse proxy, X-Forwarded-Host).
 */
export function isSameOrigin(headers) {
  let origin;
  try {
    origin = new URL(headers.origin ?? "").host;
  } catch {
    return false;
  }
  const hosts = [headers.host, (headers["x-forwarded-host"] ?? "").split(",")[0].trim()].filter(Boolean);
  return hosts.includes(origin);
}

const FORWARDED = /^(forwarded|x-forwarded-.*|x-real-ip)$/i;

/**
 * Raw header pairs ([name, value, name, value, ...]) for a request to the
 * Gateway: forwarded headers dropped, Host and Origin pointing at the Gateway,
 * and Task Panel's session cookie removed.
 */
export function gatewayHeaders(rawHeaders, gatewayHost) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const value = rawHeaders[i + 1];
    const lower = name.toLowerCase();
    if (FORWARDED.test(lower) || lower === "host") continue;
    if (lower === "origin") {
      out.push(name, `http://${gatewayHost}`);
    } else if (lower === "cookie") {
      const cookie = withoutSessionCookie(value);
      if (cookie) out.push(name, cookie);
    } else {
      out.push(name, value);
    }
  }
  return ["Host", gatewayHost, ...out];
}

/** Redirects the Gateway builds from its own address, made relative so the browser stays on this site. */
export function publicLocation(location, gatewayHost) {
  const own = `http://${gatewayHost}`;
  return location?.startsWith(`${own}/`) ? location.slice(own.length) : location;
}

/** Remembers sessions the app confirmed, briefly; a signed-out session stops working within SESSION_CACHE_MS. */
export function sessionChecker(check, now = Date.now) {
  const confirmed = new Map();
  return async (token) => {
    if (!token) return false;
    const until = confirmed.get(token);
    if (until && until > now()) return true;
    const ok = await check(token);
    if (ok) {
      if (confirmed.size >= SESSION_CACHE_MAX) confirmed.clear();
      confirmed.set(token, now() + SESSION_CACHE_MS);
    } else {
      confirmed.delete(token);
    }
    return ok;
  };
}

function askApp(appPort, token) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: appPort,
        path: "/api/agent/control-ui/session",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 204);
      },
    );
    request.setTimeout(5_000, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function pairsToObject(rawHeaders) {
  const headers = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    headers[name] = name in headers ? [].concat(headers[name], rawHeaders[i + 1]) : rawHeaders[i + 1];
  }
  return headers;
}

/**
 * Starts the proxy. `log` receives one line per startup or unexpected error.
 * Returns the http.Server.
 */
export function startControlUiProxy({ port, appPort, gatewayPort, log = () => {} }) {
  const gatewayHost = `127.0.0.1:${gatewayPort}`;
  const hasSession = sessionChecker((token) => askApp(appPort, token));

  const toApp = (req, res) => {
    const headers = { ...req.headers };
    // Next.js would fill in the proxy's own address; keep the visitor's, as before
    // the proxy existed, so login rate limits still tell clients apart.
    if (!headers["x-forwarded-for"] && req.socket.remoteAddress) headers["x-forwarded-for"] = req.socket.remoteAddress;
    const upstream = http.request({ host: "127.0.0.1", port: appPort, method: req.method, path: req.url, headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  };

  const toGateway = (req, res) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        method: req.method,
        path: req.url,
        headers: pairsToObject(gatewayHeaders(req.rawHeaders, gatewayHost)),
      },
      (response) => {
        const headers = { ...response.headers };
        if (headers.location) headers.location = publicLocation(headers.location, gatewayHost);
        res.writeHead(response.statusCode ?? 502, headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("OpenClaw is not reachable.");
    });
    req.pipe(upstream);
  };

  const server = http.createServer((req, res) => {
    if (routeFor(req.url) === "app") return toApp(req, res);
    hasSession(sessionToken(req.headers.cookie)).then(
      (ok) => {
        if (ok) return toGateway(req, res);
        if ((req.headers.accept ?? "").includes("text/html")) {
          res.writeHead(302, { location: "/", "cache-control": "no-store" });
        } else {
          res.writeHead(401, { "cache-control": "no-store" });
        }
        res.end();
      },
      () => {
        res.writeHead(502);
        res.end();
      },
    );
  });

  // Next.js serves no WebSockets in production, so every upgrade is the Control UI's.
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const refuse = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!isSameOrigin(req.headers)) return refuse("403 Forbidden");
    hasSession(sessionToken(req.headers.cookie)).then((ok) => {
      if (!ok) return refuse("401 Unauthorized");
      let connected = false;
      const upstream = net.connect(gatewayPort, "127.0.0.1", () => {
        connected = true;
        const pairs = gatewayHeaders(req.rawHeaders, gatewayHost);
        let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
        for (let i = 0; i < pairs.length; i += 2) lines += `${pairs[i]}: ${pairs[i + 1]}\r\n`;
        upstream.write(`${lines}\r\n`);
        if (head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", () => (connected ? socket.destroy() : refuse("502 Bad Gateway")));
      upstream.on("close", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
    }, () => refuse("502 Bad Gateway"));
  });

  server.on("error", (error) => log(`Proxy error: ${error.message}`));
  server.listen(port, "0.0.0.0", () => log(`Listening on :${port}; OpenClaw's Control UI is at ${CONTROL_UI_BASE_PATH}/.`));
  return server;
}
