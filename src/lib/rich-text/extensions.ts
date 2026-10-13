import type { Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { TextColorMark, TextHighlightMark } from "./marks";

// The document schema shared by the editor (browser) and validation (server).
// Changing it changes what stored descriptions may contain.

export const LINK_PROTOCOLS = ["http", "https", "mailto"];

export function isAllowedHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 2000) return false;
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function richTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        protocols: LINK_PROTOCOLS,
        isAllowedUri: (url) => isAllowedHref(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    TextColorMark,
    TextHighlightMark,
  ];
}
