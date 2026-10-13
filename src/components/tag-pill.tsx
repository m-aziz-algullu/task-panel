import { readableTextColor } from "@/lib/colors";
import type { Tag } from "@/lib/types";

export function TagPill({ tag, size = "sm" }: { tag: Pick<Tag, "name" | "color">; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full font-semibold ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      style={{ backgroundColor: tag.color, color: readableTextColor(tag.color) }}
    >
      {tag.name}
    </span>
  );
}
