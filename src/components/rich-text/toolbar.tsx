"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Ban,
  Baseline,
  Bold,
  Code,
  ExternalLink,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "@/lib/rich-text/marks";
import { ToolbarPopover } from "./popover";

export type ToolbarMenu = "color" | "highlight" | "link" | "table" | null;

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection: don't move focus to the button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rt-button ${active ? "rt-button-active" : ""}`}
    >
      <Icon className="size-4" />
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px self-center bg-border" />;

/** Adds https:// when no scheme was typed; mailto links stay as they are. */
function normalizeHref(value: string): string {
  const href = value.trim();
  if (!href) return "";
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
  return `https://${href}`;
}

function LinkForm({ editor, href, onDone }: { editor: Editor; href: string | undefined; onDone: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(href ?? "");

  const apply = () => {
    const next = normalizeHref(value);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!next) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: insert the address itself as the link text.
      chain.insertContent({ type: "text", text: next, marks: [{ type: "link", attrs: { href: next } }] }).run();
    } else chain.setLink({ href: next }).run();
    onDone();
  };

  return (
    // Not a <form>: this sits inside the task dialog's form, and forms can't nest.
    <div className="flex w-72 flex-col gap-2">
      <input
        className="input py-1.5"
        placeholder={t("editor.linkPlaceholder")}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // The task form saves on Enter elsewhere; here Enter applies the link.
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }
        }}
      />
      <div className="flex items-center gap-1">
        {href && (
          <>
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="rt-button" title={t("editor.linkOpen")}>
              <ExternalLink className="size-4" />
            </a>
            <button
              type="button"
              className="rt-button"
              title={t("editor.linkRemove")}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onDone();
              }}
            >
              <Unlink className="size-4" />
            </button>
          </>
        )}
        <button type="button" className="btn btn-primary ml-auto py-1 text-xs" onClick={apply}>
          {t("editor.linkApply")}
        </button>
      </div>
    </div>
  );
}

export function Toolbar({ editor, menu, onMenu }: { editor: Editor; menu: ToolbarMenu; onMenu: (menu: ToolbarMenu) => void }) {
  const { t } = useI18n();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      color: e.getAttributes("textColor").color as string | undefined,
      highlight: e.getAttributes("textHighlight").color as string | undefined,
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      href: e.getAttributes("link").href as string | undefined,
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const toggle = (name: Exclude<ToolbarMenu, null>) => (open: boolean) => onMenu(open ? name : null);
  const close = () => onMenu(null);

  const tableActions: { key: MessageKey; run: () => void; danger?: boolean }[] = [
    { key: "editor.addRowBefore", run: () => chain().addRowBefore().run() },
    { key: "editor.addRowAfter", run: () => chain().addRowAfter().run() },
    { key: "editor.addColumnBefore", run: () => chain().addColumnBefore().run() },
    { key: "editor.addColumnAfter", run: () => chain().addColumnAfter().run() },
    { key: "editor.toggleHeaderRow", run: () => chain().toggleHeaderRow().run() },
    { key: "editor.deleteRow", run: () => chain().deleteRow().run(), danger: true },
    { key: "editor.deleteColumn", run: () => chain().deleteColumn().run(), danger: true },
    { key: "editor.deleteTable", run: () => chain().deleteTable().run(), danger: true },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("editor.toolbar")}
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2/60 px-1.5 py-1"
    >
      <select
        aria-label={t("editor.textStyle")}
        title={t("editor.textStyle")}
        value={state.block}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "p") chain().setParagraph().run();
          else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
        }}
        className="h-7 cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 text-xs font-medium text-fg hover:bg-surface-2 focus:border-accent focus:outline-none"
      >
        <option value="p">{t("editor.normalText")}</option>
        <option value="h1">{t("editor.heading1")}</option>
        <option value="h2">{t("editor.heading2")}</option>
        <option value="h3">{t("editor.heading3")}</option>
      </select>
      <Divider />
      <ToolButton icon={Bold} label={t("editor.bold")} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton icon={Italic} label={t("editor.italic")} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton
        icon={Underline}
        label={t("editor.underline")}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <ToolButton icon={Strikethrough} label={t("editor.strike")} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <ToolButton icon={Code} label={t("editor.code")} active={state.code} onClick={() => chain().toggleCode().run()} />

      <ToolbarPopover
        open={menu === "color"}
        onOpenChange={toggle("color")}
        label={t("editor.textColor")}
        active={!!state.color}
        trigger={<Baseline className="size-4" data-color={state.color} />}
      >
        <div className="grid w-44 grid-cols-5 gap-1">
          <button
            type="button"
            title={t("editor.defaultColor")}
            aria-label={t("editor.defaultColor")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              chain().unsetTextColor().run();
              close();
            }}
            className="rt-swatch"
          >
            <span className="text-sm font-bold text-fg">A</span>
          </button>
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={t(`colors.${color}`)}
              aria-label={t(`colors.${color}`)}
              aria-pressed={state.color === color}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                chain().setTextColor(color).run();
                close();
              }}
              className={`rt-swatch ${state.color === color ? "ring-2 ring-accent" : ""}`}
            >
              <span data-color={color} className="text-sm font-bold">
                A
              </span>
            </button>
          ))}
        </div>
      </ToolbarPopover>

      <ToolbarPopover
        open={menu === "highlight"}
        onOpenChange={toggle("highlight")}
        label={t("editor.highlight")}
        active={!!state.highlight}
        trigger={<Highlighter className="size-4" />}
      >
        <div className="grid w-36 grid-cols-4 gap-1">
          <button
            type="button"
            title={t("editor.noHighlight")}
            aria-label={t("editor.noHighlight")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              chain().unsetTextHighlight().run();
              close();
            }}
            className="rt-swatch"
          >
            <Ban className="size-4 text-muted" />
          </button>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={t(`colors.${color}`)}
              aria-label={t(`colors.${color}`)}
              aria-pressed={state.highlight === color}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                chain().setTextHighlight(color).run();
                close();
              }}
              className={`rt-swatch ${state.highlight === color ? "ring-2 ring-accent" : ""}`}
            >
              <span data-highlight={color} className="size-5 rounded" />
            </button>
          ))}
        </div>
      </ToolbarPopover>

      <Divider />
      <ToolButton
        icon={List}
        label={t("editor.bulletList")}
        active={state.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolButton
        icon={ListOrdered}
        label={t("editor.orderedList")}
        active={state.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <ToolButton icon={ListChecks} label={t("editor.taskList")} active={state.taskList} onClick={() => chain().toggleTaskList().run()} />
      <Divider />
      <ToolButton icon={Quote} label={t("editor.quote")} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton
        icon={SquareCode}
        label={t("editor.codeBlock")}
        active={state.codeBlock}
        onClick={() => chain().toggleCodeBlock().run()}
      />
      <ToolButton icon={Minus} label={t("editor.divider")} onClick={() => chain().setHorizontalRule().run()} />

      <ToolbarPopover
        open={menu === "link"}
        onOpenChange={toggle("link")}
        label={t("editor.link")}
        active={state.link}
        trigger={<LinkIcon className="size-4" />}
      >
        <LinkForm key={state.href ?? ""} editor={editor} href={state.href} onDone={close} />
      </ToolbarPopover>

      <ToolbarPopover
        open={menu === "table"}
        onOpenChange={toggle("table")}
        label={t("editor.table")}
        active={state.table}
        trigger={<Table className="size-4" />}
      >
        <div className="flex w-48 flex-col">
          {!state.table ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                close();
              }}
              className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              {t("editor.insertTable")}
            </button>
          ) : (
            tableActions.map((action) => (
              <button
                key={action.key}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  action.run();
                  close();
                }}
                className={`rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
                  action.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {t(action.key)}
              </button>
            ))
          )}
        </div>
      </ToolbarPopover>

      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton icon={RemoveFormatting} label={t("editor.clearFormatting")} onClick={() => chain().unsetAllMarks().clearNodes().run()} />
        <ToolButton icon={Undo2} label={t("editor.undo")} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
        <ToolButton icon={Redo2} label={t("editor.redo")} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      </div>
    </div>
  );
}
