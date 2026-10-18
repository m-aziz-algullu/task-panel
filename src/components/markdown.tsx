"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Links open outside the panel; raw HTML in the text is never rendered, and
// react-markdown drops unsafe URLs (javascript: and the like).
const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** Markdown as the agent writes it: headings, lists, links, code, tables. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="rich-text rich-text-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
