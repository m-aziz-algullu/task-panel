import { describe, expect, it } from "vitest";
import { InvalidDocumentError, normalizeDocument, plainTextToDocument } from "@/lib/rich-text/document";

const doc = (...content: object[]) => ({ type: "doc", content });
const p = (...content: object[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: object[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });

describe("normalizeDocument", () => {
  it("keeps rich content and derives plain text", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
      p(text("Bold", [{ type: "bold" }]), text(" and "), text("red", [{ type: "textColor", attrs: { color: "red" } }])),
      { type: "bulletList", content: [{ type: "listItem", content: [p(text("one"))] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] }] },
    );
    const { doc: out, text: plain } = normalizeDocument(input);
    expect(plain).toBe("Plan\nBold and red\none\ndone");
    expect(JSON.stringify(out)).toContain('"textColor"');
    expect(JSON.stringify(out)).toContain('"checked":true');
  });

  it("drops unsafe links and colors outside the palette, keeping the text", () => {
    const input = doc(
      p(
        text("evil", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
        text(" ok", [{ type: "link", attrs: { href: "https://example.com" } }]),
        text(" css", [{ type: "textColor", attrs: { color: "red;background:url(x)" } }]),
      ),
    );
    const out = JSON.stringify(normalizeDocument(input).doc);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("https://example.com");
    expect(out).not.toContain("background");
    expect(normalizeDocument(input).text).toBe("evil ok css");
  });

  it("treats an empty document as no description", () => {
    expect(normalizeDocument(doc({ type: "paragraph" }))).toEqual({ doc: null, text: "" });
    expect(normalizeDocument(null)).toEqual({ doc: null, text: "" });
  });

  it("rejects unknown node types, broken structure and oversized input", () => {
    expect(() => normalizeDocument(doc({ type: "script", content: [] }))).toThrow(InvalidDocumentError);
    expect(() => normalizeDocument(doc({ type: "bulletList", content: [p(text("not in a listItem"))] }))).toThrow(InvalidDocumentError);
    expect(() => normalizeDocument({ type: "paragraph" })).toThrow(InvalidDocumentError);
    expect(() => normalizeDocument(doc(p(text("x".repeat(250_000)))))).toThrow(InvalidDocumentError);
  });
});

describe("plainTextToDocument", () => {
  it("turns each line into a paragraph", () => {
    const out = plainTextToDocument("first\n\nthird")!;
    expect(out.content).toHaveLength(3);
    expect(normalizeDocument(out).text).toBe("first\n\nthird");
    expect(plainTextToDocument("  ")).toBeNull();
  });
});
