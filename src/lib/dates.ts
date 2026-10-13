// Day arithmetic in an explicit IANA time zone. Days are passed around as
// "YYYY-MM-DD" keys so the server and the browser never disagree about them.

export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: string): boolean {
  if (!DAY_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The calendar day of `date` in `timeZone`, as YYYY-MM-DD. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  return new Date(keyToUtc(key) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant the day `key` starts in `timeZone`. */
export function startOfDay(key: string, timeZone: string): Date {
  const utc = keyToUtc(key);
  const guess = utc - offsetMs(new Date(utc), timeZone);
  // Re-check at the guess in case a DST change sits between the two instants.
  return new Date(utc - offsetMs(new Date(guess), timeZone));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(intlLocale: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${intlLocale}|${timeZone}|${JSON.stringify(options)}`;
  let format = formatters.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale, { timeZone, ...options });
    formatters.set(id, format);
  }
  return format;
}

export type RelativeDayLabels = { today: string; tomorrow: string; yesterday: string };

/** "Today", "Tomorrow", "Yesterday" (from `labels`) or e.g. "Tue, Oct 14" / "14 Eki Sal". */
export function formatDay(key: string, today: string, labels: RelativeDayLabels, intlLocale: string): string {
  if (key === today) return labels.today;
  if (key === addDays(today, 1)) return labels.tomorrow;
  if (key === addDays(today, -1)) return labels.yesterday;
  return formatter(intlLocale, "UTC", { day: "numeric", month: "short", weekday: "short" }).format(
    new Date(keyToUtc(key)),
  );
}

/** e.g. "Tuesday, October 13, 2026" / "13 Ekim 2026 Salı". */
export function formatLongDay(key: string, intlLocale: string): string {
  return formatter(intlLocale, "UTC", { day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(
    new Date(keyToUtc(key)),
  );
}

export function formatDateTime(iso: string, timeZone: string, intlLocale: string): string {
  return formatter(intlLocale, timeZone, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
