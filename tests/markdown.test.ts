import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, null, text));

describe("Markdown", () => {
  it("formats what the agent writes: emphasis, headings, lists, links", () => {
    const html = render("## Bulgular\n\n**Önemli** ve *not*\n\n- bir\n- iki\n\n1. ilk\n\nBkz. https://example.com");
    expect(html).toContain("<h2>Bulgular</h2>");
    expect(html).toContain("<strong>Önemli</strong>");
    expect(html).toContain("<em>not</em>");
    expect(html).toMatch(/<ul>\s*<li>bir<\/li>/);
    expect(html).toContain("<ol>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">');
  });

  it("never renders raw HTML or unsafe links", () => {
    const html = render('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(render("[x](javascript:alert)")).not.toContain("javascript:");
  });
});
