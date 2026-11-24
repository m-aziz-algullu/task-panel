// A stand-in push service for the tests: a local HTTP server that records what
// it receives, plus an independent implementation of what a browser does with it
// (RFC 8291 decryption with the subscriber's keys, RFC 8292 VAPID JWT check), so
// the tests verify the bytes on the wire, not just that a library was called.
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const b64url = (bytes: Buffer) => bytes.toString("base64url");

/** A browser's side of a subscription: its P-256 key pair and auth secret. */
export function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) },
  };
}

/** Decrypts an aes128gcm Web Push message body (RFC 8188 / RFC 8291) the way the browser does. */
export function decryptPush(body: Buffer, browser: ReturnType<typeof browserKeys>): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  if (ciphertext.length > recordSize) throw new Error("more than one record");

  const shared = browser.ecdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), browser.ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, browser.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // The last record ends with a 0x02 delimiter, then zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("bad padding delimiter");
  return padded.subarray(0, end).toString("utf8");
}

/** Checks the `Authorization: vapid t=…, k=…` header (RFC 8292) and returns the JWT claims. */
export function verifyVapid(authorization: string | undefined, expectedPublicKey: string) {
  const match = /^vapid t=([^,]+),\s*k=(.+)$/.exec(authorization ?? "");
  if (!match) throw new Error(`not a VAPID header: ${authorization}`);
  const [, jwt, k] = match;
  if (k !== expectedPublicKey) throw new Error("k is not the server's public key");
  const [header, payload, signature] = jwt.split(".");
  const point = Buffer.from(k, "base64url");
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) },
    format: "jwk",
  });
  const valid = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  if (!valid) throw new Error("JWT signature does not verify");
  const head = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg: string; typ: string };
  if (head.alg !== "ES256") throw new Error(`alg ${head.alg}`);
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as { aud: string; exp: number; sub: string };
}

export type Received = { path: string; headers: IncomingHttpHeaders; body: Buffer };
export type Reply = { status: number; headers?: Record<string, string>; body?: string };

/** A local push service. `reply` decides each answer (default 201 Created). */
export async function startPushService(reply: (request: Received) => Reply = () => ({ status: 201 })) {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = { path: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks) };
      received.push(request);
      const answer = reply(request);
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    received,
    endpoint: (name: string) => `${origin}/push/${name}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
