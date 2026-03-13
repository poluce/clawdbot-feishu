import { describe, expect, it } from "vitest";
import { normalizeFeishuMarkdownLinks } from "../text/markdown-links.js";

describe("markdown links", () => {
  it("wraps bare urls and normalizes special characters", () => {
    const result = normalizeFeishuMarkdownLinks("See https://example.com/a_b(test).");
    expect(result).toContain("[https://example.com/a%5Fb%28test%29](https://example.com/a%5Fb%28test%29).");
  });

  it("normalizes existing markdown destinations without changing labels", () => {
    const result = normalizeFeishuMarkdownLinks("[docs](https://example.com/a_b)");
    expect(result).toBe("[docs](https://example.com/a%5Fb)");
  });

  it("keeps inline code and fenced code blocks unchanged", () => {
    const text = [
      "Inline `https://example.com/a_b` should stay unchanged.",
      "```ts",
      "const url = 'https://example.com/a_b';",
      "```",
    ].join("\n");

    expect(normalizeFeishuMarkdownLinks(text)).toBe(text);
  });

  it("converts autolinks into explicit markdown links", () => {
    const result = normalizeFeishuMarkdownLinks("<https://example.com/a_b>");
    expect(result).toBe("[https://example.com/a%5Fb](https://example.com/a%5Fb)");
  });

  it("preserves suffix text after autolinks", () => {
    const result = normalizeFeishuMarkdownLinks("<https://example.com/a_b>suffix");
    expect(result).toBe("[https://example.com/a%5Fb](https://example.com/a%5Fb)suffix");
  });

  it("returns the original text when there are no urls", () => {
    expect(normalizeFeishuMarkdownLinks("plain text only")).toBe("plain text only");
  });
});
