import React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Render the model's markdown reply as formatted HTML.
//
// CROCS SECURITY: model output can contain web content the agent fetched/quoted,
// which could include malicious HTML (e.g. <img onerror>, <script>). We render
// markdown to HTML and then SANITISE it with DOMPurify before injecting, which
// strips scripts, event handlers, and dangerous tags. This closes the main XSS
// vector — important because an XSS could otherwise steal the session token.
marked.setOptions({ breaks: true, gfm: true });

export default function Markdown({ text }) {
  const dirty = marked.parse(text || "");
  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "b", "i", "u", "code", "pre", "blockquote",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "span", "table", "thead",
      "tbody", "tr", "th", "td", "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    // Never allow javascript:/data: URIs in links.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
  return <div className="md" dangerouslySetInnerHTML={{ __html: clean }} />;
}
