"use client";

import type { JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Table,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";
import { isAllowedHref, richTextExtensions } from "@/lib/rich-text/extensions";
import { SlashCommand, type SlashItem } from "./slash-command";
import { Toolbar, type ToolbarMenu } from "./toolbar";

function slashItems(t: Translate): SlashItem[] {
  return [
    { id: "p", title: t("editor.normalText"), keywords: "paragraph text paragraf metin", icon: Pilcrow, run: (e) => e.chain().focus().setParagraph().run() },
    { id: "h1", title: t("editor.heading1"), keywords: "heading title h1 başlık", icon: Heading1, run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { id: "h2", title: t("editor.heading2"), keywords: "heading title h2 başlık", icon: Heading2, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { id: "h3", title: t("editor.heading3"), keywords: "heading title h3 başlık", icon: Heading3, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { id: "ul", title: t("editor.bulletList"), keywords: "bullet list unordered madde liste", icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: "ol", title: t("editor.orderedList"), keywords: "numbered ordered list numaralı liste", icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: "todo", title: t("editor.taskList"), keywords: "todo task checklist checkbox yapılacak görev", icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run() },
    { id: "quote", title: t("editor.quote"), keywords: "quote blockquote alıntı", icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: "code", title: t("editor.codeBlock"), keywords: "code block snippet kod", icon: SquareCode, run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: "table", title: t("editor.table"), keywords: "table grid tablo", icon: Table, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "hr", title: t("editor.divider"), keywords: "divider rule line separator ayırıcı çizgi", icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ];
}

type RichTextEditorProps = {
  initialContent: JSONContent | null;
  /** Captured when the editor is created, like `initialContent`; pass a stable function. */
  onChange: (doc: JSONContent | null) => void;
  placeholder: string;
  label: string;
};

/**
 * Jira-like description editor: toolbar, Markdown shortcuts (# , - , 1. , [ ] , > , ``` , **bold**),
 * "/" quick insert, Ctrl+K for links, Ctrl+click to open one.
 */
export function RichTextEditor({ initialContent, onChange, placeholder, label }: RichTextEditorProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<ToolbarMenu>(null);

  const editor = useEditor({
    // Rendered on the client only; avoids a server/client markup mismatch.
    immediatelyRender: false,
    extensions: [
      ...richTextExtensions(),
      Placeholder.configure({ placeholder }),
      SlashCommand.configure({
        // The editor lives as long as the dialog, during which the language can't change.
        items: () => slashItems(t),
        emptyLabel: () => t("editor.slashEmpty"),
      }),
    ],
    content: initialContent ?? undefined,
    editorProps: {
      attributes: { class: "rich-text", "aria-label": label, "aria-multiline": "true", role: "textbox" },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          setMenu("link");
          return true;
        }
        return false;
      },
      handleClick: (view, pos, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const href = view.state.doc
          .resolve(pos)
          .marks()
          .find((mark) => mark.type.name === "link")?.attrs.href;
        if (!isAllowedHref(href)) return false;
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    // ProseMirror builds attrs as null-prototype objects, which React can't send to a
    // Server Action as plain data; a JSON round trip turns them into ordinary objects.
    onUpdate: ({ editor: instance }) => onChange(instance.isEmpty ? null : JSON.parse(JSON.stringify(instance.getJSON()))),
  });

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
      {editor ? (
        <Toolbar editor={editor} menu={menu} onMenu={setMenu} />
      ) : (
        <div className="h-9 border-b border-border bg-surface-2/60" />
      )}
      <EditorContent editor={editor} className="max-h-[50vh] min-h-52 overflow-y-auto" />
    </div>
  );
}
