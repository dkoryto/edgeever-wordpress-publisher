import type { FetchLike } from "./types";

export type WordPressErrorKind = "config" | "auth" | "not_found" | "network" | "http" | "invalid_response";

export class WordPressError extends Error {
  readonly kind: WordPressErrorKind;
  readonly status: number;
  readonly code: string;
  /** The `data` member of a WordPress REST error, if any. */
  readonly data: Record<string, unknown> | null;

  constructor(kind: WordPressErrorKind, message: string, options: { status?: number; code?: string; data?: Record<string, unknown> | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WordPressError";
    this.kind = kind;
    this.status = options.status ?? 0;
    this.code = options.code ?? kind;
    this.data = options.data ?? null;
  }
}

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const isLocalHost = (hostname: string) =>
  LOCAL_HOSTS.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith(".localhost");

/**
 * Normalises a user-entered site URL. HTTPS is required because Application
 * Passwords are sent with every request; plain HTTP is accepted only for
 * localhost development sites. Returns the URL without a trailing slash.
 */
export const normalizeSiteUrl = (input: string): string => {
  let raw = input.trim();
  if (!raw) throw new WordPressError("config", "WordPress site URL is not set.", { code: "missing_site_url" });
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WordPressError("config", `"${input}" is not a valid URL.`, { code: "invalid_site_url" });
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new WordPressError("config", "The WordPress site URL must use https:// (http:// is allowed only for localhost).", { code: "insecure_site_url" });
  }
  if (url.username || url.password) {
    throw new WordPressError("config", "Do not put credentials in the site URL.", { code: "invalid_site_url" });
  }
  // Users often paste the admin or REST URL; keep only the site root.
  const path = url.pathname.replace(/\/(?:wp-json|wp-admin|wp-login\.php)(?:\/.*)?$/i, "").replace(/\/+$/, "");
  return `${url.origin}${path}`;
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** HTTP Basic authorization header value (UTF-8 safe). */
export const basicAuthHeader = (username: string, password: string) =>
  `Basic ${base64(new TextEncoder().encode(`${username}:${password}`))}`;

export type PostStatus = "draft" | "publish" | "future" | "pending" | "private";

export interface PostPayload {
  title: string;
  content: string;
  status: PostStatus;
  /** UTC date in `YYYY-MM-DDTHH:mm:ss` form. */
  date_gmt?: string;
  categories?: number[];
  featured_media?: number;
}

export interface WordPressPost {
  id: number;
  link: string;
  status: PostStatus;
  date_gmt?: string;
  content?: { raw?: string; rendered?: string };
  featured_media?: number;
}

export interface WordPressMedia {
  id: number;
  source_url: string;
}

export interface WordPressUser {
  id: number;
  name: string;
  slug?: string;
}

export interface WordPressCategory {
  id: number;
  name: string;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

/** Sites detected to need `?rest_route=` (no pretty permalinks), remembered for this session. */
const plainRouteSites = new Set<string>();

const isJsonResponse = (response: Response) => (response.headers.get("content-type") ?? "").includes("json");

/** Thin WordPress REST API client using Application Password authentication. */
export class WordPressClient {
  readonly siteUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: FetchLike;
  /** Sites without pretty permalinks only answer on `?rest_route=`. */
  private plainRoutes = false;

  constructor(credentials: WordPressCredentials, fetchImpl: FetchLike) {
    this.siteUrl = normalizeSiteUrl(credentials.siteUrl);
    const username = credentials.username.trim();
    const password = credentials.applicationPassword.trim();
    if (!username) throw new WordPressError("config", "WordPress username is not set.", { code: "missing_username" });
    if (!password) throw new WordPressError("config", "WordPress Application Password is not set.", { code: "missing_password" });
    this.authorization = basicAuthHeader(username, password);
    this.fetchImpl = fetchImpl;
    this.plainRoutes = plainRouteSites.has(this.siteUrl);
  }

  buildUrl(route: string, query: RequestOptions["query"] = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const path = `/wp/v2/${route.replace(/^\/+/, "")}`;
    if (this.plainRoutes) {
      const search = params.toString();
      return `${this.siteUrl}/?rest_route=${encodeURIComponent(path)}${search ? `&${search}` : ""}`;
    }
    const search = params.toString();
    return `${this.siteUrl}/wp-json${path}${search ? `?${search}` : ""}`;
  }

  buildRequest(method: string, route: string, options: RequestOptions = {}): { url: string; init: RequestInit } {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.authorization,
      ...options.headers,
    };
    let body = options.body;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    return {
      url: this.buildUrl(route, options.query),
      // Never send browser cookies: authentication is the Application Password only.
      init: { method, headers, body, credentials: "omit", redirect: "follow" },
    };
  }

  async request<T>(method: string, route: string, options: RequestOptions = {}): Promise<T> {
    let response = await this.send(method, route, options);
    if (!this.plainRoutes && !isJsonResponse(response) && response.status !== 401 && response.status < 500) {
      // A non-JSON answer from /wp-json/ means it is not routed: with plain permalinks
      // WordPress serves the home page (200) or a theme 404 page. Retry on ?rest_route=.
      this.plainRoutes = true;
      const retry = await this.send(method, route, options);
      if (isJsonResponse(retry)) {
        response = retry;
        plainRouteSites.add(this.siteUrl);
      } else {
        this.plainRoutes = false;
      }
    }
    return this.parse<T>(response);
  }

  private async send(method: string, route: string, options: RequestOptions) {
    const { url, init } = this.buildRequest(method, route, options);
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new WordPressError("network", `Could not reach ${this.siteUrl}.`, { cause: error });
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (response.ok) {
      if (data === null) {
        throw new WordPressError("invalid_response", "WordPress returned a response that is not JSON. Check the site URL.", { status: response.status });
      }
      return data as T;
    }
    const record = (data && typeof data === "object" ? data : {}) as { code?: string; message?: string; data?: unknown };
    const code = typeof record.code === "string" ? record.code : `http_${response.status}`;
    const message = typeof record.message === "string" ? record.message.replace(/<[^>]+>/g, "") : `HTTP ${response.status}`;
    const kind: WordPressErrorKind =
      response.status === 401 || response.status === 403 ? "auth" : response.status === 404 ? "not_found" : "http";
    const details = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null;
    throw new WordPressError(kind, message, { status: response.status, code, data: details });
  }

  getCurrentUser() {
    return this.request<WordPressUser>("GET", "users/me", { query: { context: "edit" } });
  }

  createPost(payload: PostPayload) {
    return this.request<WordPressPost>("POST", "posts", { json: payload });
  }

  updatePost(postId: number, payload: Partial<PostPayload>) {
    return this.request<WordPressPost>("POST", `posts/${postId}`, { json: payload });
  }

  getPost(postId: number) {
    return this.request<WordPressPost>("GET", `posts/${postId}`, { query: { context: "edit" } });
  }

  getMedia(mediaId: number) {
    return this.request<WordPressMedia>("GET", `media/${mediaId}`, { query: { context: "edit" } });
  }

  uploadMedia(file: Blob, filename: string, mimeType: string) {
    return this.request<WordPressMedia>("POST", "media", {
      body: file,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  searchCategories(search: string) {
    return this.request<WordPressCategory[]>("GET", "categories", { query: { search, per_page: 100 } });
  }

  createCategory(name: string) {
    return this.request<WordPressCategory>("POST", "categories", { json: { name } });
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

/** ASCII-only filename safe for a Content-Disposition header, with an extension. */
export const safeFilename = (filename: string | null | undefined, mimeType: string, fallback: string) => {
  const cleaned = (filename ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  const base = cleaned || fallback.replace(/[^\w.-]+/g, "-");
  if (/\.[A-Za-z0-9]{2,5}$/.test(base)) return base;
  const extension = EXTENSIONS[mimeType.toLowerCase()];
  return extension ? `${base}.${extension}` : base;
};
