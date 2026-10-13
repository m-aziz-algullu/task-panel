"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Tag, Task } from "@/lib/types";
import { TagPill } from "./tag-pill";

export type Filters = { query: string; tagIds: number[] };

export const EMPTY_FILTERS: Filters = { query: "", tagIds: [] };

export function isFiltering(filters: Filters): boolean {
  return filters.query.trim() !== "" || filters.tagIds.length > 0;
}

/**
 * Text matches title, description or #id; tags match when the task has any selected tag.
 * `intlLocale` drives case folding (Turkish İ/ı lowercase differently).
 */
export function matchesFilters(task: Task, filters: Filters, intlLocale: string): boolean {
  const query = filters.query.trim().toLocaleLowerCase(intlLocale);
  if (query) {
    const haystack = `${task.title}\n${task.description}\n#${task.id}`.toLocaleLowerCase(intlLocale);
    if (!haystack.includes(query)) return false;
  }
  return filters.tagIds.length === 0 || task.tagIds.some((id) => filters.tagIds.includes(id));
}

/** True when a keyboard shortcut should not fire because the user is typing or a dialog is open. */
export function shortcutBlocked(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  if (target?.closest("input, textarea, select, [contenteditable=true]")) return true;
  return Boolean(document.querySelector("dialog[open]"));
}

export function FilterBar({
  tags,
  filters,
  onChange,
}: {
  tags: Tag[];
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !shortcutBlocked(event)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTag = (id: number) =>
    onChange({
      ...filters,
      tagIds: filters.tagIds.includes(id) ? filters.tagIds.filter((t) => t !== id) : [...filters.tagIds, id],
    });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          className="input py-1.5 pr-8 pl-8"
          placeholder={t("filters.search")}
          value={filters.query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onChange({ ...filters, query: "" });
              event.currentTarget.blur();
            }
          }}
        />
        {!focused && !filters.query && (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1.5 font-mono text-[10px] text-muted">
            /
          </kbd>
        )}
      </div>
      {tags.map((tag) => {
        const active = filters.tagIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={active}
            title={active ? t("filters.removeFilter") : t("filters.filterByTag")}
            onClick={() => toggleTag(tag.id)}
            className={`cursor-pointer rounded-full transition ${
              active ? "ring-2 ring-fg/70 ring-offset-1 ring-offset-bg" : "opacity-60 saturate-75 hover:opacity-100"
            }`}
          >
            <TagPill tag={tag} size="md" />
          </button>
        );
      })}
      {isFiltering(filters) && (
        <button type="button" className="btn btn-ghost text-muted" onClick={() => onChange(EMPTY_FILTERS)}>
          <X className="size-4" /> {t("common.clear")}
        </button>
      )}
    </div>
  );
}
