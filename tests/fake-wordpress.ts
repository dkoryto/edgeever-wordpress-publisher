import type { FetchLike } from "../src/types";

interface Post {
  id: number;
  title: string;
  content: string;
  status: string;
  date_gmt?: string;
  categories: number[];
  featured_media: number;
}

/** Minimal in-memory WordPress REST API used to exercise the publishing core. */
export const createFakeWordPress = (options: { password?: string; canCreateCategories?: boolean } = {}) => {
  const password = options.password ?? "app pass";
  const posts = new Map<number, Post>();
  const media = new Map<number, { id: number; source_url: string; bytes: number; type: string; filename: string }>();
  const categories = new Map<number, string>([[1, "Uncategorized"], [7, "News"]]);
  const log: Array<{ method: string; path: string }> = [];
  let nextId = 100;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const postView = (post: Post) => ({ ...post, link: `https://blog.example.com/?p=${post.id}` });

  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^.*\/wp-json\/wp\/v2\//, "");
    log.push({ method, path });
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== `Basic ${btoa(`editor:${password}`)}`) {
      return json(401, { code: "incorrect_password", message: "The provided password is an invalid application password.", data: { status: 401 } });
    }
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;

    if (method === "GET" && path === "users/me") return json(200, { id: 2, name: "Editor", slug: "editor" });
    if (method === "POST" && path === "posts") {
      const post: Post = { id: nextId++, title: body.title, content: body.content, status: body.status, date_gmt: body.date_gmt, categories: body.categories ?? [1], featured_media: body.featured_media ?? 0 };
      posts.set(post.id, post);
      return json(201, postView(post));
    }
    const postMatch = path.match(/^posts\/(\d+)$/);
    if (postMatch) {
      const post = posts.get(Number(postMatch[1]));
      if (!post) return json(404, { code: "rest_post_invalid_id", message: "Invalid post ID.", data: { status: 404 } });
      if (method === "POST") Object.assign(post, body);
      return json(200, postView(post));
    }
    if (method === "POST" && path === "media") {
      const blob = init.body as Blob;
      const filename = headers["Content-Disposition"].match(/filename="(.+)"/)?.[1] ?? "file";
      const item = { id: nextId++, source_url: `https://blog.example.com/wp-content/uploads/${filename}`, bytes: blob.size, type: headers["Content-Type"], filename };
      media.set(item.id, item);
      return json(201, item);
    }
    const mediaMatch = path.match(/^media\/(\d+)$/);
    if (mediaMatch) {
      const item = media.get(Number(mediaMatch[1]));
      return item ? json(200, item) : json(404, { code: "rest_post_invalid_id", message: "Invalid post ID." });
    }
    if (method === "GET" && path === "categories") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      return json(200, [...categories].filter(([, name]) => name.toLowerCase().includes(search)).map(([id, name]) => ({ id, name })));
    }
    if (method === "POST" && path === "categories") {
      if (!options.canCreateCategories) return json(403, { code: "rest_cannot_create", message: "Sorry, you are not allowed to create terms in this taxonomy." });
      const id = nextId++;
      categories.set(id, body.name);
      return json(201, { id, name: body.name });
    }
    return json(404, { code: "rest_no_route", message: "No route" });
  };

  return { fetch, posts, media, categories, log };
};
