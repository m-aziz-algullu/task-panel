import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_SIZE_HEADER,
  announcedSize,
  downloadPercent,
  fileNameFromDisposition,
  readWithProgress,
} from "@/lib/download";

/** A response whose body arrives in the given chunks. */
function chunked(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("announcedSize", () => {
  const sized = (value?: string) => new Headers(value === undefined ? {} : { [DOWNLOAD_SIZE_HEADER]: value });

  it("reads the byte count the server sent", () => {
    expect(announcedSize(sized("2048"))).toBe(2048);
  });

  it("is null when the header is missing, empty, zero or not a whole number", () => {
    for (const value of [undefined, "", "0", "-5", "12.5", "1e3", "abc", "99999999999999999999"]) {
      expect(announcedSize(sized(value))).toBeNull();
    }
  });
});

describe("downloadPercent", () => {
  it("is null without a known total", () => {
    expect(downloadPercent(500, null)).toBeNull();
    expect(downloadPercent(500, 0)).toBeNull();
  });

  it("rounds down to a whole percent", () => {
    expect(downloadPercent(0, 1000)).toBe(0);
    expect(downloadPercent(426, 1000)).toBe(42);
  });

  it("stays below 100 until the stream ends, even if the size was off", () => {
    expect(downloadPercent(1000, 1000)).toBe(99);
    expect(downloadPercent(5000, 1000)).toBe(99);
  });
});

describe("fileNameFromDisposition", () => {
  const fallback = "backup.json";

  it("reads a quoted or bare file name", () => {
    expect(fileNameFromDisposition('attachment; filename="task-panel-backup-2026-11-25.json"', fallback)).toBe(
      "task-panel-backup-2026-11-25.json",
    );
    expect(fileNameFromDisposition("attachment; filename=plain.json; size=3", fallback)).toBe("plain.json");
  });

  it("prefers the RFC 5987 UTF-8 name", () => {
    expect(
      fileNameFromDisposition(`attachment; filename="yedek.json"; filename*=UTF-8''g%C3%B6rev%20yede%C4%9Fi.json`, fallback),
    ).toBe("görev yedeği.json");
  });

  it("falls back on a broken encoded name to the plain one", () => {
    expect(fileNameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="ok.json"`, fallback)).toBe(
      "ok.json",
    );
  });

  it("never returns a path", () => {
    expect(fileNameFromDisposition('attachment; filename="../../etc/passwd"', fallback)).toBe(".._.._etc_passwd");
    expect(fileNameFromDisposition('attachment; filename="a\\b.json"', fallback)).toBe("a_b.json");
  });

  it("uses the fallback when there is no name", () => {
    expect(fileNameFromDisposition(null, fallback)).toBe(fallback);
    expect(fileNameFromDisposition("attachment", fallback)).toBe(fallback);
    expect(fileNameFromDisposition('attachment; filename="  "', fallback)).toBe(fallback);
  });
});

describe("readWithProgress", () => {
  it("collects every chunk and reports the running byte count", async () => {
    const seen: number[] = [];
    const blob = await readWithProgress(
      chunked(['{"a":', '"ğ"', "}"], { "Content-Type": "application/json" }),
      (received) => seen.push(received),
    );
    expect(await blob.text()).toBe('{"a":"ğ"}');
    expect(blob.type).toBe("application/json");
    // "ğ" is two bytes in UTF-8.
    expect(seen).toEqual([5, 9, 10]);
  });

  it("returns an empty file for a response without a body", async () => {
    const blob = await readWithProgress(new Response(null), () => {
      throw new Error("no progress expected");
    });
    expect(blob.size).toBe(0);
  });

  it("stops and cancels the stream when aborted", async () => {
    const abort = new AbortController();
    let cancelled = false;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
        sent++;
      },
      cancel() {
        cancelled = true;
      },
    });
    const reading = readWithProgress(
      new Response(body),
      (received) => {
        if (received >= 30) abort.abort();
      },
      abort.signal,
    );
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(10);
  });

  it("rejects right away when the signal is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(readWithProgress(chunked(["x"]), () => {}, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
