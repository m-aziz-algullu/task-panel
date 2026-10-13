"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { LucideIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// Jira-style quick insert: type "/" and pick a block.

export type SlashItem = {
  id: string;
  title: string;
  /** Extra words to match while filtering (in both languages). */
  keywords: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
};

type SlashCommandOptions = {
  items: () => SlashItem[];
  emptyLabel: () => string;
};

type MenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean };
type MenuProps = SuggestionProps<SlashItem, SlashItem> & { emptyLabel: string };

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu({ items, command, emptyLabel }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Back to the first item whenever the filter changes.
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setSelected(0);
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((selected + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((selected - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[selected]);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={listRef}
      role="listbox"
      className="z-50 max-h-72 w-60 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-sm shadow-xl"
    >
      {items.length === 0 && <p className="px-2 py-1.5 text-muted">{emptyLabel}</p>}
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            data-index={index}
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left ${
              index === selected ? "bg-surface-2 text-fg" : "text-fg"
            }`}
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border bg-surface">
              <Icon className="size-4" />
            </span>
            {item.title}
          </button>
        );
      })}
    </div>
  );
});

const slashKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { items: () => [], emptyLabel: () => "" };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        // Rendered inside the open <dialog> so it isn't hidden behind the modal's top layer.
        container: "dialog[open]",
        floatingUi: { strategy: "fixed" },
        items: ({ query }) => {
          const q = query.toLocaleLowerCase();
          return options.items().filter((item) => `${item.title} ${item.keywords}`.toLocaleLowerCase().includes(q));
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let component: ReactRenderer<MenuHandle, MenuProps> | undefined;
          let unmount: (() => void) | undefined;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: { ...props, emptyLabel: options.emptyLabel() },
                editor: props.editor,
              });
              unmount = props.mount(component.element as HTMLElement);
            },
            onUpdate: (props) => component?.updateProps({ ...props, emptyLabel: options.emptyLabel() }),
            onKeyDown: ({ event, view }) => {
              if (event.key === "Escape") {
                // Handled here so Escape closes the menu, not the task dialog.
                exitSuggestion(view, slashKey);
                return true;
              }
              return component?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              unmount?.();
              component?.destroy();
              unmount = undefined;
              component = undefined;
            },
          };
        },
      }),
    ];
  },
});
