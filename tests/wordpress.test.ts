import { describe, expect, test } from "bun:test";
import { WordPressClient, WordPressError, basicAuthHeader, normalizeSiteUrl, safeFilename } from "../src/wordpress";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8" } });

describe("normalizeSiteUrl", () => {
  test("keeps HTTPS sites and strips trailing paths", () => {
    expect(normalizeSiteUrl("https://blog.example.com/")).toBe("https://blog.example.com");
    expect(normalizeSiteUrl("blog.example.com")).toBe("https://blog.example.com");
    expect(normalizeSiteUrl("https://example.com/blog/wp-admin/")).toBe("https://example.com/blog");
    expect(normalizeSiteUrl("https://example.com/wp-json/wp/v2")).toBe("https://example.com");
  });

  test("allows plain HTTP only for localhost", () => {
    expect(normalizeSiteUrl("http://localhost:8089")).toBe("http://localhost:8089");
    expect(normalizeSiteUrl("http://127.0.0.1:8080/wp")).toBe("http://127.0.0.1:8080/wp");
    expect(normalizeSiteUrl("http://wp.localhost")).toBe("http://wp.localhost");
    expect(() => normalizeSiteUrl("http://blog.example.com")).toThrow(WordPressError);
    expect(() => normalizeSiteUrl("ftp://blog.example.com")).toThrow(/https/);
    expect(() => normalizeSiteUrl("")).toThrow(/not set/);
    expect(() => normalizeSiteUrl("https://user:pass@example.com")).toThrow(/credentials/);
  });
});

test("basicAuthHeader encodes UTF-8 credentials", () => {
  expect(basicAuthHeader("admin", "abcd efgh")).toBe(`Basic ${btoa("admin:abcd efgh")}`);
  const header = basicAuthHeader("zoë", "pw");
  expect(new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)))).toBe("zoë:pw");
});

describe("WordPressClient requests", () => {
  const credentials = { siteUrl: "https://blog.example.com/", username: "editor", applicationPassword: " abcd efgh ijkl " };

  test("builds authenticated JSON requests without cookies", () => {
    const client = new WordPressClient(credentials, async () => json(200, {}));
    const { url, init } = client.buildRequest("POST", "posts/12", { json: { title: "T" } });
    expect(url).toBe("https://blog.example.com/wp-json/wp/v2/posts/12");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("editor:abcd efgh ijkl")}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"title":"T"}');
  });

  test("uploads media with filename and content type", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new WordPressClient(credentials, async (url, init) => {
      calls.push({ url, init });
      return json(201, { id: 5, source_url: "https://blog.example.com/wp-content/uploads/a.png" });
    });
    const media = await client.uploadMedia(new Blob([new Uint8Array([1, 2])], { type: "image/png" }), "a.png", "image/png");
    expect(media.id).toBe(5);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://blog.example.com/wp-json/wp/v2/media");
    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="a.png"');
    expect(calls[0].init?.body).toBeInstanceOf(Blob);
  });

  test("falls back to ?rest_route= when pretty permalinks are off", async () => {
    const urls: string[] = [];
    const client = new WordPressClient({ ...credentials, siteUrl: "https://plain-404.example.com" }, async (url) => {
      urls.push(url);
      return url.includes("/wp-json/") ? new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } }) : json(200, { id: 1, name: "Editor" });
    });
    expect((await client.getCurrentUser()).name).toBe("Editor");
    expect(urls[1]).toBe("https://plain-404.example.com/?rest_route=%2Fwp%2Fv2%2Fusers%2Fme&context=edit");
    await client.getCurrentUser();
    expect(urls).toHaveLength(3);
    // The detection is remembered for later clients of the same site.
    const later = new WordPressClient({ ...credentials, siteUrl: "https://plain-404.example.com" }, async () => json(200, {}));
    expect(later.buildUrl("posts")).toContain("?rest_route=");
  });

  test("also falls back when /wp-json/ serves the home page (200 HTML)", async () => {
    const urls: string[] = [];
    const client = new WordPressClient({ ...credentials, siteUrl: "https://plain-200.example.com" }, async (url) => {
      urls.push(url);
      return url.includes("/wp-json/") ? new Response("<html>Home</html>", { status: 200, headers: { "content-type": "text/html" } }) : json(201, { id: 3, link: "x", status: "draft" });
    });
    expect((await client.createPost({ title: "t", content: "c", status: "draft" })).id).toBe(3);
    expect(urls[1]).toContain("?rest_route=%2Fwp%2Fv2%2Fposts");
  });

  test("classifies errors", async () => {
    const respond = (response: Response | Error) =>
      new WordPressClient(credentials, async () => {
        if (response instanceof Error) throw response;
        return response;
      });
    const auth = await respond(json(401, { code: "incorrect_password", message: "The provided password is an invalid application password." })).getCurrentUser().catch((e) => e);
    expect(auth).toMatchObject({ kind: "auth", status: 401, code: "incorrect_password" });
    const forbidden = await respond(json(403, { code: "rest_cannot_create", message: "Sorry, you are not allowed" })).createPost({ title: "", content: "", status: "draft" }).catch((e) => e);
    expect(forbidden.kind).toBe("auth");
    const missing = await respond(json(404, { code: "rest_post_invalid_id", message: "Invalid post ID." })).updatePost(9, {}).catch((e) => e);
    expect(missing).toMatchObject({ kind: "not_found", status: 404 });
    const network = await respond(new TypeError("Failed to fetch")).getCurrentUser().catch((e) => e);
    expect(network).toMatchObject({ kind: "network" });
    const html = await respond(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })).getCurrentUser().catch((e) => e);
    expect(html.kind).toBe("invalid_response");
  });

  test("requires username and password", () => {
    expect(() => new WordPressClient({ ...credentials, username: " " }, fetch)).toThrow(/username/);
    expect(() => new WordPressClient({ ...credentials, applicationPassword: "" }, fetch)).toThrow(/Application Password/);
  });
});

test("safeFilename", () => {
  expect(safeFilename("Screen shot 1.png", "image/png", "x")).toBe("Screen-shot-1.png");
  expect(safeFilename("图片", "image/jpeg", "edgeever-res_1")).toBe("edgeever-res_1.jpg");
  expect(safeFilename(null, "image/webp", "edgeever-res_2")).toBe("edgeever-res_2.webp");
  expect(safeFilename('a"b.png', "image/png", "x")).toBe("a-b.png");
});
