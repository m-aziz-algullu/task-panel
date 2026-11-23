import "server-only";

import { createECDH } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { generateVAPIDKeys } from "web-push";
import { schema, type Db } from "../db";
import { base64UrlBytes, bytesToBase64Url } from "./shape";

const { appSettings, users } = schema;
const KEY = "push.vapid";

type Env = Record<string, string | undefined>;

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** VAPID_* is set wrong; push stays off until it's fixed, and the logs and settings page say why. */
export class VapidConfigError extends Error {}

/** The public key that belongs to a private key, or null if it isn't a P-256 private key. */
function publicKeyOf(privateKey: string): string | null {
  const bytes = base64UrlBytes(privateKey);
  if (!bytes || bytes.length !== 32) return null;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(bytes));
    return bytesToBase64Url(ecdh.getPublicKey());
  } catch {
    return null;
  }
}

/** Keys from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, checked to be a matching pair; null if neither is set. */
export function vapidKeysFromEnv(env: Env = process.env): { publicKey: string; privateKey: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) {
    throw new VapidConfigError("Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither.");
  }
  const derived = publicKeyOf(privateKey);
  if (!derived) throw new VapidConfigError("VAPID_PRIVATE_KEY is not a URL-safe base64 P-256 private key.");
  if (derived !== publicKey.replace(/=+$/, "")) {
    throw new VapidConfigError("VAPID_PUBLIC_KEY does not belong to VAPID_PRIVATE_KEY.");
  }
  return { publicKey: derived, privateKey };
}

/**
 * The key pair stored in the database, generated on first use. Kept there (not
 * in a file) so it survives redeploys: a new pair would cut off every browser
 * that subscribed with the old one. Not part of backups.
 */
async function storedKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  const read = async () => {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
    if (!row) return null;
    try {
      const value = JSON.parse(row.value) as { publicKey?: unknown; privateKey?: unknown };
      if (typeof value.privateKey !== "string") return null;
      const publicKey = publicKeyOf(value.privateKey);
      return publicKey ? { publicKey, privateKey: value.privateKey } : null;
    } catch {
      return null;
    }
  };
  const existing = await read();
  if (existing) return existing;
  const generated = generateVAPIDKeys();
  const value = JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey });
  // Two instances starting at once: the first insert wins and both use its pair.
  await db.insert(appSettings).values({ key: KEY, value }).onConflictDoNothing();
  const winner = await read();
  if (winner) return winner;
  // A row that isn't a valid pair (edited by hand): replace it.
  await db.update(appSettings).set({ value }).where(eq(appSettings.key, KEY));
  return { publicKey: generated.publicKey, privateKey: generated.privateKey };
}

/**
 * VAPID's "subject": how a push service can reach whoever runs this server.
 * VAPID_SUBJECT if set (mailto: or https:), else the admin account's email.
 */
async function vapidSubject(db: Db, env: Env): Promise<string> {
  const configured = env.VAPID_SUBJECT?.trim();
  if (configured) {
    if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(configured)) {
      throw new VapidConfigError("VAPID_SUBJECT must be a mailto: or https: URL.");
    }
    return configured;
  }
  const [admin] = await db.select({ email: users.email }).from(users).orderBy(asc(users.id)).limit(1);
  return `mailto:${admin?.email ?? "admin@task-panel.invalid"}`;
}

/** The server's VAPID keys and subject. Throws VapidConfigError when the env is set wrong. */
export async function getVapidKeys(db: Db, env: Env = process.env): Promise<VapidKeys> {
  const keys = vapidKeysFromEnv(env) ?? (await storedKeys(db));
  return { ...keys, subject: await vapidSubject(db, env) };
}
