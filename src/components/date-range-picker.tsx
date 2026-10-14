"use client";

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { addDays } from "@/lib/dates";

export type DateRange = { from: string; to: string };

const EMPTY_RANGE: DateRange = { from: "", to: "" };

type Cell = { key: string; inMonth: boolean };

const toUtc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const monthStart = (key: string) => `${key.slice(0, 7)}-01`;

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Six Monday-first weeks covering the month that contains `key`. */
function monthGrid(key: string): Cell[] {
  const first = monthStart(key);
  const offset = (new Date(toUtc(first)).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(gridStart, i);
    return { key: day, inMonth: day.slice(0, 7) === first.slice(0, 7) };
  });
}

/**
 * One control for picking a day or a range of days: a button that opens a calendar
 * popover with quick presets. Empty strings mean "no range picked".
 */
export function DateRangePicker({
  value,
  onChange,
  today,
  placeholder,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  today: string;
  /** Shown on the button while no range is picked. */
  placeholder: string;
}) {
  const { t, intlLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(value.to || value.from || today));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: "UTC" });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [intlLocale]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(toUtc(month)),
      ),
    [intlLocale, month],
  );

  const shortDay = (key: string) =>
    new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(toUtc(key)),
    );

  const hasValue = value.from !== "" || value.to !== "";
  const label = !hasValue
    ? placeholder
    : value.from && value.to
      ? value.from === value.to
        ? shortDay(value.from)
        : `${shortDay(value.from)} – ${shortDay(value.to)}`
      : value.from
        ? `${shortDay(value.from)} →`
        : `← ${shortDay(value.to)}`;

  // While the second click is pending, preview the range up to the hovered day.
  const preview: DateRange = anchor
    ? hover && hover < anchor
      ? { from: hover, to: anchor }
      : { from: anchor, to: hover && hover > anchor ? hover : anchor }
    : value;

  const apply = (range: DateRange) => {
    onChange(range);
    setAnchor(null);
    setHover(null);
    setOpen(false);
  };

  const pick = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      onChange({ from: day, to: day });
      return;
    }
    apply(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
  };

  const presets: { label: string; range: DateRange }[] = [
    { label: t("days.today"), range: { from: today, to: today } },
    { label: t("days.yesterday"), range: { from: addDays(today, -1), to: addDays(today, -1) } },
    { label: t("completed.last7"), range: EMPTY_RANGE },
    { label: t("completed.last30"), range: { from: addDays(today, -29), to: today } },
    { label: t("completed.thisMonth"), range: { from: monthStart(today), to: today } },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="input flex w-auto min-w-52 cursor-pointer items-center gap-2 py-1.5 text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setMonth(monthStart(value.to || value.from || today));
          setAnchor(null);
          setOpen((current) => !current);
        }}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" />
        <span className={`flex-1 truncate text-sm ${hasValue ? "" : "text-muted"}`}>{label}</span>
        {hasValue && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.clear")}
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
            onClick={(event) => {
              event.stopPropagation();
              apply(EMPTY_RANGE);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                apply(EMPTY_RANGE);
              }
            }}
          >
            <X className="size-3.5" />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={placeholder}
          className="absolute top-full left-0 z-30 mt-2 flex w-max max-w-[calc(100vw-2rem)] gap-3 rounded-xl border border-border bg-surface p-3 shadow-xl"
        >
          <div className="flex w-64 flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="icon-btn size-7"
                aria-label={t("completed.prevMonth")}
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-semibold capitalize">{monthLabel}</span>
              <button
                type="button"
                className="icon-btn size-7"
                aria-label={t("completed.nextMonth")}
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted uppercase">
              {weekdays.map((name) => (
                <span key={name} className="py-1">
                  {name.slice(0, 2)}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
              {monthGrid(month).map(({ key, inMonth }) => {
                const disabled = key > today;
                const isStart = preview.from === key;
                const isEnd = preview.to === key;
                const inRange = preview.from !== "" && preview.to !== "" && key > preview.from && key < preview.to;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isStart || isEnd}
                    onMouseEnter={() => setHover(key)}
                    onClick={() => pick(key)}
                    className={`h-8 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                      isStart || isEnd
                        ? "bg-accent font-semibold text-accent-fg"
                        : inRange
                          ? "bg-accent/15"
                          : inMonth
                            ? "hover:bg-surface-2"
                            : "text-muted/60 hover:bg-surface-2"
                    } ${isStart && !isEnd ? "rounded-l-md" : ""} ${isEnd && !isStart ? "rounded-r-md" : ""} ${
                      isStart && isEnd ? "rounded-md" : ""
                    } ${!isStart && !isEnd && !inRange ? "rounded-md" : ""} ${
                      key === today && !isStart && !isEnd ? "ring-1 ring-accent/60 ring-inset" : ""
                    }`}
                  >
                    {Number(key.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex w-36 flex-col gap-1 border-l border-border pl-3">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn btn-ghost justify-start px-2 py-1.5 text-sm"
                onClick={() => apply(preset.range)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
