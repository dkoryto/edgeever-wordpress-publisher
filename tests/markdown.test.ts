import { describe, expect, test } from "bun:test";
import {
  collectResourceReferences,
  extractProperties,
  getResourceId,
  isSafeUrl,
  markdownToHtml,
  prepareNote,
} from "../src/markdown";

describe("markdownToHtml", () => {
  test("renders common Markdown and GFM", () => {
    const html = markdownToHtml("## Heading\n\nSome **bold** and *italic* text with `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
  });

  test("escapes code blocks and keeps the language class", () => {
    const html = markdownToHtml("```js\nconst a = '<b>';\n```");
    expect(html).toBe(`<pre><code class="language-js">const a = '&lt;b&gt;';</code></pre>`);
  });

  test("never emits scripts, event handlers or iframes from raw HTML", () => {
    const html = markdownToHtml('Hello <script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n<iframe src="https://evil"></iframe>\n\nKeep <u>underline</u> and <mark>mark</mark>.');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<u>underline</u>");
    expect(html).toContain("<mark>mark</mark>");
  });

  test("drops unsafe link and image URLs", () => {
    const html = markdownToHtml("[click](javascript:alert(1)) ![x](data:text/html;base64,AAAA) [ok](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("click");
    expect(html).toContain('<a href="https://example.com">ok</a>');
  });

  test("removes EdgeEver plugin embed blocks", () => {
    const html = markdownToHtml("Before\n\n```edgeever-plugin-embed\n{\"type\":\"drawing\"}\n```\n\nAfter");
    expect(html).not.toContain("drawing");
    expect(html).toContain("After");
  });
});

describe("resource URL rewriting", () => {
  const markdown = "![Diagram](/api/v1/resources/res_1/blob)\n\n![Desktop](edgeever-resource://resource/res_2)\n\n[Report.pdf](/api/v1/resources/res_3/blob)\n\n![External](https://cdn.example.com/a.png)";

  test("recognises API paths and desktop protocol URLs", () => {
    expect(getResourceId("/api/v1/resources/res_1/blob")).toBe("res_1");
    expect(getResourceId("https://notes.example.com/api/v1/resources/res%2F9/blob?x=1")).toBe("res/9");
    expect(getResourceId("edgeever-resource://resource/res_2")).toBe("res_2");
    expect(getResourceId("https://cdn.example.com/a.png")).toBeNull();
  });

  test("collects references in order without duplicates", () => {
    const refs = collectResourceReferences(`${markdown}\n\n![again](/api/v1/resources/res_1/blob)`);
    expect(refs.map((ref) => [ref.resourceId, ref.kind])).toEqual([
      ["res_1", "image"],
      ["res_2", "image"],
      ["res_3", "link"],
    ]);
  });

  test("replaces uploaded resources with media URLs and degrades the rest to text", () => {
    const html = markdownToHtml(markdown, {
      resourceUrls: new Map([
        ["res_1", "https://blog.example.com/wp-content/uploads/diagram.png"],
        ["res_3", "https://blog.example.com/wp-content/uploads/report.pdf"],
      ]),
    });
    expect(html).toContain('<img src="https://blog.example.com/wp-content/uploads/diagram.png" alt="Diagram">');
    expect(html).toContain('<a href="https://blog.example.com/wp-content/uploads/report.pdf">Report.pdf</a>');
    expect(html).toContain("Desktop");
    expect(html).not.toContain("edgeever-resource://");
    expect(html).not.toContain("/api/v1/resources/");
    expect(html).toContain('<img src="https://cdn.example.com/a.png" alt="External">');
  });
});

describe("note properties", () => {
  test("reads and strips YAML front matter", () => {
    const { markdown, properties } = extractProperties("---\nwordpress_date: \"2026-10-12 09:30\"\nwordpress_categories: News, 7\n---\nBody");
    expect(properties).toEqual({ date: "2026-10-12 09:30", categories: "News, 7" });
    expect(markdown).toBe("Body");
  });

  test("reads standalone property lines, including escaped underscores", () => {
    const { markdown, properties } = extractProperties("Intro\n\nwordpress\\_date: 2026-11-01T08:00\n\nMore");
    expect(properties.date).toBe("2026-11-01T08:00");
    expect(markdown).not.toContain("wordpress");
    expect(markdown).toContain("More");
  });

  test("leaves a thematic break that is not front matter alone", () => {
    const source = "---\nJust a paragraph between rules.\n---\nText";
    expect(extractProperties(source).markdown).toBe(source);
  });

  test("uses the note title and drops a duplicated leading H1", () => {
    expect(prepareNote({ title: "Hello", contentMarkdown: "# Hello\n\nBody" })).toEqual({ title: "Hello", markdown: "Body", properties: {} });
    expect(prepareNote({ title: null, contentMarkdown: "# From heading\n\nBody" }).title).toBe("From heading");
    expect(prepareNote({ title: "Other", contentMarkdown: "# Hello\n\nBody" }).markdown).toBe("# Hello\n\nBody");
    expect(prepareNote({ title: "", contentMarkdown: "Body" }).title).toBe("Untitled");
  });
});

test("isSafeUrl", () => {
  for (const ok of ["https://a.b", "http://a.b", "mailto:x@y.z", "#top", "/path", "page.html", "../up"]) expect(isSafeUrl(ok)).toBe(true);
  for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,x", "vbscript:x", ""]) expect(isSafeUrl(bad)).toBe(false);
});
