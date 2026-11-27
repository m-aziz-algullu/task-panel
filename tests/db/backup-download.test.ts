// GET /api/backup against a real (in-memory PGlite) database: the file the
// settings page downloads, and the headers its progress display relies on.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.PGLITE_DIR = "memory://";
  process.env.APP_TIMEZONE = "Europe/Istanbul";
  return { user: null as { id: number; name: string; email: string; role: string } | null };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => state.user),
  requireSession: vi.fn(async () => state.user),
}));
vi.mock("@/lib/openclaw/connection", () => ({ agentEnabled: () => false, gatewayConnection: () => null }));
vi.mock("@/lib/agent/worker", () => ({ pokeAgentWorker: vi.fn(), abortSession: vi.fn() }));

import { GET } from "@/app/api/backup/route";
import { BACKUP_FORMAT, backupFileName, parseBackup } from "@/lib/backup-shape";
import { getClock } from "@/lib/data";
import { schema } from "@/lib/db";
import { DOWNLOAD_SIZE_HEADER, announcedSize, fileNameFromDisposition, readWithProgress } from "@/lib/download";
import { resetDb } from "./helpers";

beforeEach(async () => {
  const db = await resetDb();
  state.user = { id: 1, name: "Aziz", email: "a@example.com", role: "admin" };
  // Non-ASCII text, so the announced size has to count bytes, not characters.
  await db.insert(schema.tags).values({ name: "işler ğüşöç", color: "#2563eb" });
});

describe("GET /api/backup", () => {
  it("refuses without a session", async () => {
    state.user = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "errors.unauthorized" });
  });

  it("sends the backup with its exact uncompressed size and file name", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const size = announcedSize(response.headers);
    const progress: number[] = [];
    const blob = await readWithProgress(response, (received) => progress.push(received));
    expect(size).toBe(blob.size);
    expect(Number(response.headers.get(DOWNLOAD_SIZE_HEADER))).toBe(new TextEncoder().encode(await blob.text()).length);
    expect(progress.at(-1)).toBe(size);

    const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), "fallback.json");
    expect(fileName).toBe(backupFileName(getClock().today));

    const parsed = parseBackup(JSON.parse(await blob.text()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup.format).toBe(BACKUP_FORMAT);
      expect(parsed.backup.data.tags.map((tag) => tag.name)).toEqual(["işler ğüşöç"]);
    }
  });
});
