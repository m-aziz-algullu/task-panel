"use client";

import { Check } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { TAG_COLOR_PRESETS, readableTextColor } from "@/lib/colors";

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useI18n();
  const custom = !TAG_COLOR_PRESETS.includes(value.toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TAG_COLOR_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition hover:scale-110"
          style={{ backgroundColor: color, boxShadow: value.toLowerCase() === color ? `0 0 0 2px ${color}` : undefined }}
          aria-label={t("tags.color", { color })}
          aria-pressed={value.toLowerCase() === color}
        >
          {value.toLowerCase() === color && <Check className="size-3.5" style={{ color: readableTextColor(color) }} />}
        </button>
      ))}
      <label
        className={`relative inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${
          custom ? "border-accent text-fg" : "border-border text-muted"
        }`}
        title={t("tags.customColor")}
      >
        <span className="size-3 rounded-full border border-border" style={{ backgroundColor: value }} />
        {t("tags.custom")}
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function randomPresetColor(): string {
  return TAG_COLOR_PRESETS[Math.floor(Math.random() * TAG_COLOR_PRESETS.length)];
}
