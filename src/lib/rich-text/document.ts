import { getSchema, type JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { richTextExtensions, isAllowedHref } from "./extensions";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "./marks";

// Validation and conversion of stored descriptions. Runs on the server for
// every save, so whatever the browser sends, only schema-valid content with
// palette colors and safe links reaches the database.

export const MAX_DOCUMENT_CHARS = 200_000;

let cachedSchema: Schema | undefined;
function schema(): Schema {
  cachedSchema ??= getSchema(richTextExtensions());
  return cachedSchema;
}

type Mark = NonNullable<JSONContent["marks"]>[number];

function keepMark(mark: Mark): boolean {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "link":
      return isAllowedHref(attrs.href);
    case "textColor":
      return (TEXT_COLORS as readonly string[]).includes(attrs.color);
    case "textHighlight":
      return (HIGHLIGHT_COLORS as readonly string[]).includes(attrs.color);
    default:
      return true;
  }
}

/** Drops marks with values outside what the editor offers (unknown colors, unsafe links). */
export function stripUnsafeMarks(node: JSONContent): JSONContent {
  const { marks, content, ...rest } = node;
  const clean: JSONContent = { ...rest };
  const kept = marks?.filter(keepMark);
  if (kept && kept.length > 0) clean.marks = kept;
  if (content) clean.content = content.map(stripUnsafeMarks);
  return clean;
}

export class InvalidDocumentError extends Error {}

/** One line per paragraph, heading, list item or table cell; hard breaks become newlines. */
function plainText(node: PMNode): string {
  const lines: string[] = [];
  node.descendants((child) => {
    if (!child.isTextblock) return true;
    lines.push(child.textBetween(0, child.content.size, undefined, "\n"));
    return false;
  });
  return lines.join("\n").trim();
}

/**
 * Validates a document against the editor schema and derives its plain text.
 * Returns `doc: null` for an empty document. Throws InvalidDocumentError for
 * anything that isn't a valid document.
 */
export function normalizeDocument(input: unknown): { doc: JSONContent | null; text: string } {
  if (input === null || input === undefined) return { doc: null, text: "" };
  if (typeof input !== "object" || (input as JSONContent).type !== "doc") {
    throw new InvalidDocumentError("Not a document.");
  }
  if (JSON.stringify(input).length > MAX_DOCUMENT_CHARS) throw new InvalidDocumentError("Document too large.");

  let node;
  try {
    node = schema().nodeFromJSON(stripUnsafeMarks(input as JSONContent));
    node.check();
  } catch (error) {
    throw new InvalidDocumentError(error instanceof Error ? error.message : "Invalid document.");
  }

  const text = plainText(node);
  const onlyEmptyParagraph = node.childCount === 1 && node.firstChild?.type.name === "paragraph" && node.firstChild.childCount === 0;
  if (node.childCount === 0 || onlyEmptyParagraph) return { doc: null, text: "" };
  return { doc: node.toJSON() as JSONContent, text };
}

/** Descriptions saved before the editor existed are plain text; one paragraph per line. */
export function plainTextToDocument(text: string): JSONContent | null {
  if (!text.trim()) return null;
  return {
    type: "doc",
    content: text.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}
