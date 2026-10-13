"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";

type ToolbarPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  active?: boolean;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
};

/** A toolbar button with a small panel under it. Escape and outside clicks close it. */
export function ToolbarPopover({ open, onOpenChange, label, active, trigger, children, align = "start" }: ToolbarPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close only the popover; preventDefault keeps the <dialog> from closing too.
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenChange(!open)}
        className={`rt-button gap-0.5 px-1.5 ${active || open ? "rt-button-active" : ""}`}
      >
        {trigger}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div
          className={`absolute top-full z-40 mt-1 rounded-lg border border-border bg-surface p-2 shadow-xl ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
