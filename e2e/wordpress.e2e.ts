/**
 * End-to-end test of the publishing core against a real WordPress started by
 * e2e/run.sh. The EdgeEver side is an in-memory fake plugin context holding one
 * Markdown note and one image resource.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { postStorageKey, publishNote, testConnection } from "../src/publisher";
import type { FetchLike } from "../src/types";
import { basicAuthHeader } from "../src/wordpress";
import { createFakeContext, imageResource, PNG_BYTES } from "../tests/fake-context";

const SITE = process.env.WP_E2E_SITE ?? "";
const USER = process.env.WP_E2E_USER ?? "";
const PASSWORD = process.env.WP_E2E_PASSWORD ?? "";
const PHASE = process.env.WP_E2E_PHASE ?? "pretty";
const enabled = Boolean(SITE && USER && PASSWORD);

const requested: string[] = [];
const recordingFetch: FetchLike = (input, init) => {
  requested.push(`${init?.method ?? "GET"} ${input}`);
  return fetch(input, init);
};

/** Direct REST call used only for verification, independent of the plugin client. */
const rest = async (route: string, init: RequestInit = {}) => {
  const url = PHASE === "plain" ? `${SITE}/?rest_route=/wp/v2/${route.replace("?", "&")}` : `${SITE}/wp-json/wp/v2/${route}`;
  const response = await fetch(url, { ...init, headers: { Authorization: basicAuthHeader(USER, PASSWORD), ...(init.headers ?? {}) } });
  return { status: response.status, body: (await response.json()) as any };
};

const NOTE_ID = `note_e2e_${PHASE}`;
const markdown = (extra = "") =>
  `# EdgeEver E2E ${PHASE}\n\nHello from **EdgeEver** with a [link](https://example.com).\n\n![Pixel](/api/v1/resources/res_pixel/blob)\n\n- [x] done\n- item\n\n<script>alert(1)</script>\n${extra}`;

describe.skipIf(!enabled)(`WordPress E2E (${PHASE} permalinks)`, () => {
  const fake = createFakeContext({
    fetch: recordingFetch,
    settings: {
      site_url: SITE,
      username: USER,
      application_password: PASSWORD,
      default_status: "draft",
      default_categories: "EdgeEver",
      upload_images: true,
      featured_image: true,
    },
    resources: [imageResource("res_pixel", NOTE_ID, PNG_BYTES)],
  });
  let postId = 0;
  let mediaUrl = "";

  beforeAll(() => {
    requested.length = 0;
  });

  test("test connection reads /users/me", async () => {
    const { user } = await testConnection(fake.context);
    expect(user.slug ?? user.name).toBe(USER);
    const route = PHASE === "plain" ? "?rest_route=%2Fwp%2Fv2%2Fusers%2Fme" : "/wp-json/wp/v2/users/me";
    expect(requested.some((entry) => entry.includes(route))).toBe(true);
  });

  test("rejects a wrong Application Password with an auth error", async () => {
    const bad = createFakeContext({ fetch, settings: { site_url: SITE, username: USER, application_password: "wrong pass word" } });
    await expect(testConnection(bad.context)).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  test("creates a draft with the image uploaded to the Media Library", async () => {
    const result = await publishNote(fake.context, { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown() }, { kind: "draft" });
    expect(result).toMatchObject({ action: "created", status: "draft", media: { uploaded: 1, failed: 0 }, unresolvedCategories: [] });
    postId = result.postId;

    const { status, body: post } = await rest(`posts/${postId}?context=edit`);
    expect(status).toBe(200);
    expect(post.status).toBe("draft");
    expect(post.title.raw).toBe(`EdgeEver E2E ${PHASE}`);
    const html: string = post.content.raw;
    expect(html).toContain("<strong>EdgeEver</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).not.toContain("<h1>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("/api/v1/resources/");

    // Featured image and the rewritten <img src> both point at the uploaded media.
    expect(post.featured_media).toBeGreaterThan(0);
    const media = await rest(`media/${post.featured_media}?context=edit`);
    expect(media.status).toBe(200);
    expect(media.body.mime_type).toBe("image/png");
    mediaUrl = media.body.source_url;
    expect(html).toContain(`<img src="${mediaUrl}" alt="Pixel">`);

    // The file served by WordPress is byte-identical to the EdgeEver resource.
    const served = new Uint8Array(await (await fetch(mediaUrl)).arrayBuffer());
    expect(served).toEqual(PNG_BYTES);

    // The category was created and assigned.
    const categories = await rest(`categories?search=EdgeEver`);
    const category = categories.body.find((entry: { name: string }) => entry.name === "EdgeEver");
    expect(post.categories).toContain(category.id);

    expect(fake.storage.get(postStorageKey(SITE, NOTE_ID))).toMatchObject({ postId, siteUrl: SITE });
  });

  test("publishing again updates the same post and reuses the media", async () => {
    const before = await rest(`media?per_page=100`);
    const result = await publishNote(
      fake.context,
      { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown("\nUpdated paragraph.") },
      { kind: "draft" },
    );
    expect(result).toMatchObject({ action: "updated", postId, media: { uploaded: 0, reused: 1 } });
    const { body: post } = await rest(`posts/${postId}?context=edit`);
    expect(post.content.raw).toContain("Updated paragraph.");
    expect(post.content.raw).toContain(mediaUrl);
    const after = await rest(`media?per_page=100`);
    expect(after.body.length).toBe(before.body.length);
    const all = await rest(`posts?status=draft,publish,future&search=${encodeURIComponent(`EdgeEver E2E ${PHASE}`)}&context=edit`);
    expect(all.body.filter((entry: { id: number }) => entry.id === postId)).toHaveLength(1);
    expect(all.body).toHaveLength(1);
  });

  test("publish switches the same post to published", async () => {
    const result = await publishNote(fake.context, { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown() }, { kind: "default" }, {
      settings: { siteUrl: SITE, username: USER, applicationPassword: PASSWORD, defaultStatus: "publish", categories: "", uploadImages: true, featuredImage: false },
    });
    expect(result).toMatchObject({ action: "updated", postId, status: "publish" });
    const { body: post } = await rest(`posts/${postId}?context=edit`);
    expect(post.status).toBe("publish");
    // The public permalink renders the post with the uploaded image.
    const page = await (await fetch(post.link)).text();
    expect(page).toContain(mediaUrl);
  });

  test("schedules a post with status future", async () => {
    const date = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    date.setUTCSeconds(0, 0);
    const result = await publishNote(fake.context, { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown() }, { kind: "schedule", date });
    expect(result).toMatchObject({ postId, status: "future" });
    const { body: post } = await rest(`posts/${postId}?context=edit`);
    expect(post.status).toBe("future");
    expect(post.date_gmt).toBe(date.toISOString().slice(0, 19));
  });

  test("publishing the scheduled post again publishes it now", async () => {
    const result = await publishNote(fake.context, { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown() }, { kind: "default" }, {
      settings: { siteUrl: SITE, username: USER, applicationPassword: PASSWORD, defaultStatus: "publish", categories: "", uploadImages: true, featuredImage: false },
    });
    expect(result).toMatchObject({ postId, status: "publish", action: "updated" });
    const { body: post } = await rest(`posts/${postId}?context=edit`);
    expect(post.status).toBe("publish");
    expect(new Date(`${post.date_gmt}Z`).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("creates a new post when the remembered one was deleted in WordPress", async () => {
    const removed = await rest(`posts/${postId}?force=true`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const result = await publishNote(fake.context, { id: NOTE_ID, title: `EdgeEver E2E ${PHASE}`, contentMarkdown: markdown() }, { kind: "draft" });
    expect(result.action).toBe("recreated");
    expect(result.postId).not.toBe(postId);
    const { status, body } = await rest(`posts/${result.postId}?context=edit`);
    expect(status).toBe(200);
    expect(body.status).toBe("draft");
  });

  test("used the expected REST route style for every plugin request", () => {
    const pluginRequests = requested.filter((entry) => !entry.includes("wrong"));
    expect(pluginRequests.length).toBeGreaterThan(10);
    if (PHASE === "pretty") {
      expect(pluginRequests.filter((entry) => entry.includes("rest_route"))).toEqual([]);
    } else {
      // Only the very first request probes /wp-json/ before switching to ?rest_route=.
      expect(pluginRequests.filter((entry) => entry.includes("/wp-json/"))).toHaveLength(1);
    }
  });

  test("CORS allows browser requests with an Authorization header", async () => {
    const origin = "https://notes.example.com";
    const url = PHASE === "plain" ? `${SITE}/?rest_route=/wp/v2/posts` : `${SITE}/wp-json/wp/v2/posts`;
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,content-disposition" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    const allowed = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-disposition");
  });
});

test.skipIf(enabled)("E2E skipped: run `bun run test:e2e` to start WordPress in Docker", () => {});
