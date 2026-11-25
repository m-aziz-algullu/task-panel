// Downloading a file through fetch instead of a plain link, so the page can show
// what is happening: a link gives no sign of life while the server builds the
// file. Pure apart from `saveBlob`, which needs a DOM; safe for Client
// Components and unit tests.

/**
 * Header with the body's size in bytes before any compression. Content-Length
 * can't be used for progress: a compressing proxy drops it or reports the
 * compressed size, while the stream the page reads is decompressed.
 */
export const DOWNLOAD_SIZE_HEADER = "X-Download-Size";

/** The size the server announced, or null when it is missing or not a number. */
export function announcedSize(headers: Headers): number | null {
  const value = headers.get(DOWNLOAD_SIZE_HEADER);
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

/**
 * Whole percent received, or null when the total is unknown. Never 100 before
 * the stream ends (the size header may be off), so 100 always means done.
 */
export function downloadPercent(received: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(99, Math.floor((received / total) * 100)));
}

/** The file name from a Content-Disposition header, or `fallback`. */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  let name: string | undefined;
  if (extended) {
    try {
      name = decodeURIComponent(extended[1].trim());
    } catch {
      name = undefined;
    }
  }
  name ??= /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/
    .exec(header)
    ?.slice(1)
    .find((part) => part !== undefined);
  // Only a bare name: never a path the browser might try to honour.
  const clean = name?.replace(/[/\\]/g, "_").trim();
  return clean ? clean : fallback;
}

/**
 * Reads a response body to a Blob, calling `onProgress` with the bytes read so
 * far after every chunk. Rejects with an AbortError when `signal` aborts.
 */
export async function readWithProgress(
  response: Response,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const type = response.headers.get("Content-Type") ?? "";
  if (!response.body) return new Blob([], { type });
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.byteLength;
      onProgress(received);
    }
    signal?.throwIfAborted();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new Blob(chunks, { type });
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  // Firefox only follows links that are in the document.
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
