import { Mark, mergeAttributes } from "@tiptap/core";

// Text color and highlight store a palette *name*, not a hex value, so CSS can
// map each name to a shade that reads well in both light and dark mode.

export const TEXT_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "purple", "red", "gray"] as const;

export type TextColor = (typeof TEXT_COLORS)[number];
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    textHighlight: {
      setTextHighlight: (color: HighlightColor) => ReturnType;
      unsetTextHighlight: () => ReturnType;
    };
  }
}

function paletteMark(name: string, attribute: string, palette: readonly string[]) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        color: {
          default: null,
          parseHTML: (element) => element.getAttribute(attribute),
          renderHTML: (attributes) => (attributes.color ? { [attribute]: attributes.color } : {}),
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: `span[${attribute}]`,
          getAttrs: (element) => (palette.includes(element.getAttribute(attribute) ?? "") ? null : false),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes), 0];
    },
  });
}

export const TextColorMark = paletteMark("textColor", "data-color", TEXT_COLORS).extend({
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const TextHighlightMark = paletteMark("textHighlight", "data-highlight", HIGHLIGHT_COLORS).extend({
  addCommands() {
    return {
      setTextHighlight:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
