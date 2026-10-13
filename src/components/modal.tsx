"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg";
};

/** A native modal <dialog>, shown as soon as it mounts. Render it conditionally. */
export function Modal({ title, onClose, children, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        // A press on the dialog element itself (not its content) is on the backdrop.
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl ${
        size === "lg" ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}
