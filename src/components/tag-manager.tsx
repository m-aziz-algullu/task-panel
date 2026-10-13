"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createTag, deleteTag, updateTag } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import type { Tag } from "@/lib/types";
import { ColorPicker } from "./color-picker";
import { Modal } from "./modal";
import { TagPill } from "./tag-pill";

type Draft = { name: string; color: string };

function TagForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<MessageKey | null>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const message = await onSubmit(draft);
          setError(message);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <input
          className="input"
          placeholder={t("tags.namePlaceholder")}
          value={draft.name}
          maxLength={40}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          autoFocus
        />
        <span className="shrink-0">
          <TagPill tag={{ name: draft.name.trim() || t("tags.preview"), color: draft.color }} size="md" />
        </span>
      </div>
      <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t("common.discard")}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending || !draft.name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function TagManager({ tags, onClose }: { tags: Tag[]; onClose: () => void }) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<MessageKey | null>(null);
  const [, startTransition] = useTransition();

  return (
    <Modal title={t("tags.title")} onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <section className="rounded-lg border border-border bg-surface-2/50 p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("tags.new")}</h3>
          <TagForm
            key={formKey}
            initial={{ name: "", color: "#3b82f6" }}
            submitLabel={t("common.add")}
            onSubmit={async (draft) => {
              const result = await createTag(draft);
              if (!result.ok) return result.error;
              setFormKey((k) => k + 1);
              return null;
            }}
          />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("tags.existing", { count: tags.length })}</h3>
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
          {tags.length === 0 && <p className="text-sm text-muted">{t("tags.none")}</p>}
          <ul className="flex flex-col divide-y divide-border">
            {tags.map((tag) =>
              editingId === tag.id ? (
                <li key={tag.id} className="py-3">
                  <TagForm
                    initial={{ name: tag.name, color: tag.color }}
                    submitLabel={t("common.save")}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (draft) => {
                      const result = await updateTag(tag.id, draft);
                      if (!result.ok) return result.error;
                      setEditingId(null);
                      return null;
                    }}
                  />
                </li>
              ) : (
                <li key={tag.id} className="flex items-center gap-2 py-2">
                  <TagPill tag={tag} size="md" />
                  <span className="font-mono text-xs text-muted">{tag.color}</span>
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("common.edit")}
                      aria-label={t("tags.editLabel", { name: tag.name })}
                      onClick={() => setEditingId(tag.id)}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn hover:text-red-600"
                      title={t("common.delete")}
                      aria-label={t("tags.deleteLabel", { name: tag.name })}
                      onClick={() => {
                        if (!confirm(t("tags.deleteConfirm", { name: tag.name }))) return;
                        startTransition(async () => {
                          const result = await deleteTag(tag.id);
                          setError(result.ok ? null : result.error);
                        });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
