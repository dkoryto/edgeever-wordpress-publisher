import { Marked, type Token, type Tokens } from "marked";

/** Note properties the plugin understands. Everything else is ignored. */
export interface NoteProperties {
  /** Raw `wordpress_date` value, if present. */
  date?: string;
  /** Raw `wordpress_categories` value, if present. */
  categories?: string;
}

export interface PreparedNote {
  title: string;
  markdown: string;
  properties: NoteProperties;
}

const PROPERTY_KEYS: Record<string, keyof NoteProperties> = {
  wordpress_date: "date",
  wordpress_categories: "categories",
};

// EdgeEver's Markdown serializer may escape underscores (`wordpress\_date`).
const PROPERTY_LINE = /^[ \t]*(wordpress\\?_(?:date|categories))[ \t]*:[ \t]*(.*?)[ \t]*$/gim;
const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2").trim();

/**
 * Reads `wordpress_*` properties from a leading YAML front matter block or from
 * standalone `wordpress_date: ...` lines, and removes them from the Markdown so
 * they are not published.
 */
export const extractProperties = (markdown: string): { markdown: string; properties: NoteProperties } => {
  const properties: NoteProperties = {};
  let body = markdown;

  const frontmatter = body.match(FRONTMATTER);
  if (frontmatter) {
    const remaining: string[] = [];
    let recognised = false;
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_\\]+)\s*:\s*(.*?)\s*$/);
      const key = match ? PROPERTY_KEYS[match[1].replace("\\", "")] : undefined;
      if (match && key) {
        properties[key] = unquote(match[2]);
        recognised = true;
      } else {
        remaining.push(line);
      }
    }
    // Only consume the block when it looks like real front matter.
    if (recognised || frontmatter[1].split(/\r?\n/).every((line) => !line.trim() || /^\s*[\w-]+\s*:/.test(line))) {
      body = body.slice(frontmatter[0].length);
    }
  }

  body = body.replace(PROPERTY_LINE, (_line, rawKey: string, value: string) => {
    const key = PROPERTY_KEYS[rawKey.replace("\\", "").toLowerCase()];
    if (key && properties[key] === undefined) properties[key] = unquote(value);
    return "";
  });

  return { markdown: body.replace(/^\s*\n/, ""), properties };
};

/**
 * Normalises a note before publishing: extracts properties, resolves the title,
 * and drops a leading H1 that repeats the title (WordPress renders the title itself).
 */
export const prepareNote = (note: { title: string | null; contentMarkdown: string }): PreparedNote => {
  const { markdown, properties } = extractProperties(note.contentMarkdown);
  const heading = markdown.match(/^#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/);
  const title = note.title?.trim() || heading?.[1]?.trim() || "Untitled";
  const body = heading && heading[1].trim() === title ? markdown.slice(heading[0].length).replace(/^\s*\n/, "") : markdown;
  return { title, markdown: body, properties };
};

/** Extracts an EdgeEver resource ID from an API path or a desktop protocol URL. */
export const getResourceId = (href: string): string | null => {
  if (!href) return null;
  if (href.startsWith("edgeever-resource://")) {
    try {
      const id = decodeURIComponent(new URL(href).pathname.replace(/^\//, ""));
      return id || null;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(href, "http://edgeever.local");
    const match = parsed.pathname.match(/\/api\/v1\/resources\/([^/]+)\/blob$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};

export interface ResourceReference {
  resourceId: string;
  kind: "image" | "link";
  alt: string;
}

const lexer = new Marked({ gfm: true });

/** Lists EdgeEver resources referenced by images or links, in document order, deduplicated. */
export const collectResourceReferences = (markdown: string): ResourceReference[] => {
  const seen = new Map<string, ResourceReference>();
  lexer.walkTokens(lexer.lexer(markdown), (token) => {
    if (token.type !== "image" && token.type !== "link") return;
    const resourceId = getResourceId((token as Tokens.Image | Tokens.Link).href);
    if (!resourceId) return;
    const existing = seen.get(resourceId);
    // An image reference wins over a link reference for the same resource.
    if (!existing || (existing.kind === "link" && token.type === "image")) {
      seen.set(resourceId, { resourceId, kind: token.type === "image" ? "image" : "link", alt: (token as Tokens.Image).text ?? "" });
    }
  });
  return [...seen.values()];
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/|[^:/?#]+(?:[/?#]|$))/i;

/** Allows http(s), mailto, tel, fragments and relative URLs; rejects javascript:, data:, etc. */
export const isSafeUrl = (href: string) => {
  const trimmed = href.trim().replace(/[\u0000-\u001F\u007F\s]+/g, "");
  return trimmed !== "" && SAFE_URL.test(trimmed);
};

// Formatting-only tags without attributes are kept; every other raw HTML tag is escaped
// and therefore shown as text. This guarantees no <script>, event handlers or iframes.
const ALLOWED_RAW_TAG = /^<\/?(?:u|mark|sub|sup|kbd|ins|del|s|small|br|details|summary)\s*\/?>$/i;

const neutraliseRawHtml = (html: string) =>
  html.replace(/<\/?[A-Za-z!][^>]*>?/g, (tag) => (ALLOWED_RAW_TAG.test(tag) ? tag : escapeHtml(tag)));

export interface RenderOptions {
  /** resourceId -> public URL (WordPress media `source_url`). */
  resourceUrls?: ReadonlyMap<string, string>;
}

/**
 * Converts note Markdown to HTML for WordPress. Resource URLs are replaced with
 * uploaded media URLs; resources without an uploaded URL are rendered as plain
 * text (images by their alt text) instead of broken links back to EdgeEver.
 */
export const markdownToHtml = (markdown: string, options: RenderOptions = {}): string => {
  const resourceUrls = options.resourceUrls ?? new Map<string, string>();
  const marked = new Marked({
    gfm: true,
    breaks: false,
    walkTokens(token: Token) {
      if (token.type !== "link" && token.type !== "image") return;
      const typed = token as Tokens.Link | Tokens.Image;
      const resourceId = getResourceId(typed.href);
      if (resourceId) {
        typed.href = resourceUrls.get(resourceId) ?? "";
      } else if (!isSafeUrl(typed.href)) {
        typed.href = "";
      }
    },
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return neutraliseRawHtml(text);
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? "").trim().split(/\s+/)[0] ?? "";
        // Plugin embeds only render inside EdgeEver.
        if (language === "edgeever-plugin-embed") return "";
        const className = language ? ` class="language-${escapeHtml(language)}"` : "";
        return `<pre><code${className}>${escapeHtml(text.replace(/\n$/, ""))}</code></pre>\n`;
      },
      image({ href, title, text }: Tokens.Image) {
        if (!href) return escapeHtml(text);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}>`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        if (!href) return inner;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${titleAttr}>${inner}</a>`;
      },
    },
  });
  return (marked.parse(markdown, { async: false }) as string).trim();
};
