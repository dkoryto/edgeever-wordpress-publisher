import { describe, expect, test } from "bun:test";
import { PublishInputError, postStorageKey, publishNote, testConnection } from "../src/publisher";
import { createFakeContext, imageResource, PNG_BYTES } from "./fake-context";
import { createFakeWordPress } from "./fake-wordpress";

const SETTINGS = {
  site_url: "https://blog.example.com",
  username: "editor",
  application_password: "app pass",
  default_status: "draft",
  upload_images: true,
};

const NOTE = {
  id: "note_1",
  title: "Hello WordPress",
  contentMarkdown: "# Hello WordPress\n\nIntro with **bold**.\n\n![Pixel](/api/v1/resources/res_img/blob)\n",
};

const setup = (settings: Record<string, string | boolean> = {}, wpOptions = {}) => {
  const wp = createFakeWordPress(wpOptions);
  const fake = createFakeContext({ fetch: wp.fetch, settings: { ...SETTINGS, ...settings }, resources: [imageResource("res_img", "note_1", PNG_BYTES)] });
  return { wp, ...fake };
};

describe("publishNote", () => {
  test("creates a draft, uploads the image, and rewrites its URL", async () => {
    const { wp, context, storage } = setup();
    const result = await publishNote(context, NOTE, { kind: "draft" });
    expect(result).toMatchObject({ action: "created", status: "draft", media: { uploaded: 1, reused: 0, failed: 0, skipped: 0 } });
    const post = wp.posts.get(result.postId)!;
    expect(post.title).toBe("Hello WordPress");
    expect(post.content).not.toContain("<h1>");
    expect(post.content).toContain("<strong>bold</strong>");
    expect(post.content).toContain('<img src="https://blog.example.com/wp-content/uploads/res_img.png" alt="Pixel">');
    expect([...wp.media.values()][0]).toMatchObject({ bytes: PNG_BYTES.byteLength, type: "image/png" });
    expect(storage.get(postStorageKey("https://blog.example.com", "note_1"))).toMatchObject({ postId: result.postId, siteUrl: "https://blog.example.com" });
  });

  test("updates the same post on the next publish and reuses uploaded media", async () => {
    const { wp, context, reads } = setup();
    const first = await publishNote(context, NOTE, { kind: "draft" });
    const second = await publishNote(context, { ...NOTE, contentMarkdown: `${NOTE.contentMarkdown}\nMore text.` }, { kind: "default" });
    expect(second.action).toBe("updated");
    expect(second.postId).toBe(first.postId);
    expect(wp.posts.size).toBe(1);
    expect(wp.media.size).toBe(1);
    expect(reads).toEqual(["res_img"]);
    expect(second.media).toMatchObject({ uploaded: 0, reused: 1 });
    expect(wp.posts.get(first.postId)!.content).toContain("More text.");
    expect(wp.log.filter((entry) => entry.method === "POST" && entry.path === `posts/${first.postId}`)).toHaveLength(1);
  });

  test("uses the default status setting for the publish command", async () => {
    const { wp, context } = setup({ default_status: "publish" });
    const result = await publishNote(context, NOTE, { kind: "default" });
    expect(result.status).toBe("publish");
    expect(wp.posts.get(result.postId)!.status).toBe("publish");
  });

  test("creates a new post when the remembered one was deleted remotely", async () => {
    const { wp, context } = setup();
    const first = await publishNote(context, NOTE, { kind: "draft" });
    wp.posts.delete(first.postId);
    const second = await publishNote(context, NOTE, { kind: "draft" });
    expect(second.action).toBe("recreated");
    expect(second.postId).not.toBe(first.postId);
    expect(wp.posts.size).toBe(1);
  });

  test("re-uploads media that was deleted from the library", async () => {
    const { wp, context } = setup();
    await publishNote(context, NOTE, { kind: "draft" });
    wp.media.clear();
    const result = await publishNote(context, NOTE, { kind: "draft" });
    expect(result.media).toMatchObject({ uploaded: 1, reused: 0 });
  });

  test("tracks posts per site", async () => {
    const { wp, context } = setup();
    await publishNote(context, NOTE, { kind: "draft" });
    const other = await publishNote(context, NOTE, { kind: "draft" }, { settings: { siteUrl: "https://blog.example.com/other", username: "editor", applicationPassword: "app pass", defaultStatus: "draft", categories: "", uploadImages: true, featuredImage: false } });
    expect(other.action).toBe("created");
    expect(wp.posts.size).toBe(2);
  });

  test("schedules with status future and a UTC date", async () => {
    const { wp, context } = setup();
    const now = new Date("2026-10-05T10:00:00Z");
    const result = await publishNote(context, NOTE, { kind: "schedule", date: new Date("2026-10-12T07:30:00Z") }, { now });
    expect(result.status).toBe("future");
    expect(wp.posts.get(result.postId)).toMatchObject({ status: "future", date_gmt: "2026-10-12T07:30:00" });
    expect(result.scheduledFor?.toISOString()).toBe("2026-10-12T07:30:00.000Z");
  });

  test("publishing a scheduled post without a date publishes it now", async () => {
    const { wp, context } = setup({ default_status: "publish" });
    const now = new Date("2026-10-05T10:00:00Z");
    const scheduled = await publishNote(context, NOTE, { kind: "schedule", date: new Date("2026-10-12T07:30:00Z") }, { now });
    const later = new Date("2026-10-06T08:00:00Z");
    const published = await publishNote(context, NOTE, { kind: "default" }, { now: later });
    expect(published).toMatchObject({ postId: scheduled.postId, action: "updated", status: "publish" });
    expect(wp.posts.get(scheduled.postId)).toMatchObject({ status: "publish", date_gmt: "2026-10-06T08:00:00" });
  });

  test("rejects past schedule dates and unreadable wordpress_date properties", async () => {
    const { context } = setup();
    const now = new Date("2026-10-05T10:00:00Z");
    await expect(publishNote(context, NOTE, { kind: "schedule", date: new Date("2026-10-01T00:00:00Z") }, { now })).rejects.toBeInstanceOf(PublishInputError);
    await expect(publishNote(context, { ...NOTE, contentMarkdown: "wordpress_date: tomorrow\n\nBody" }, { kind: "default" }, { now })).rejects.toThrow(/wordpress_date/);
  });

  test("a future wordpress_date property turns publish into a scheduled post", async () => {
    const { wp, context } = setup({ default_status: "publish" });
    const now = new Date("2026-10-05T10:00:00Z");
    const note = { ...NOTE, contentMarkdown: "---\nwordpress_date: 2026-12-24T18:00:00+01:00\n---\nMerry" };
    const result = await publishNote(context, note, { kind: "default" }, { now });
    expect(wp.posts.get(result.postId)).toMatchObject({ status: "future", date_gmt: "2026-12-24T17:00:00" });
    expect(wp.posts.get(result.postId)!.content).toBe("<p>Merry</p>");
  });

  test("wordpress_date also schedules when the default status is draft, but not for Save as draft", async () => {
    const { wp, context } = setup({ default_status: "draft" });
    const now = new Date("2026-10-05T10:00:00Z");
    const note = { ...NOTE, contentMarkdown: "wordpress_date: 2026-12-24T18:00Z\n\nBody" };
    const scheduled = await publishNote(context, note, { kind: "default" }, { now });
    expect(scheduled.status).toBe("future");
    const draft = await publishNote(context, note, { kind: "draft" }, { now });
    expect(wp.posts.get(draft.postId)).toMatchObject({ status: "draft", date_gmt: "2026-12-24T18:00:00" });
  });

  test("keeps going when an image fails and reports it", async () => {
    const { wp, context } = setup();
    const note = { ...NOTE, contentMarkdown: `${NOTE.contentMarkdown}\n![Missing](/api/v1/resources/res_missing/blob)` };
    const result = await publishNote(context, note, { kind: "draft" });
    expect(result.media).toMatchObject({ uploaded: 1, failed: 1 });
    const content = wp.posts.get(result.postId)!.content;
    expect(content).toContain("Missing");
    expect(content).not.toContain("res_missing");
  });

  test("does not upload images when the setting is off", async () => {
    const { wp, context, reads } = setup({ upload_images: false });
    const result = await publishNote(context, NOTE, { kind: "draft" });
    expect(result.media.skipped).toBe(1);
    expect(reads).toEqual([]);
    expect(wp.media.size).toBe(0);
    expect(wp.posts.get(result.postId)!.content).not.toContain("<img");
  });

  test("resolves categories by ID and name, and reports ones it cannot create", async () => {
    const { wp, context } = setup({ default_categories: "news, 3, Brand New" });
    const result = await publishNote(context, NOTE, { kind: "draft" });
    expect(wp.posts.get(result.postId)!.categories).toEqual([7, 3]);
    expect(result.unresolvedCategories).toEqual(["Brand New"]);

    const allowed = setup({ default_categories: "Brand New" }, { canCreateCategories: true });
    const created = await publishNote(allowed.context, NOTE, { kind: "draft" });
    expect(allowed.wp.categories.get(allowed.wp.posts.get(created.postId)!.categories[0])).toBe("Brand New");
  });

  test("sets the featured image when enabled", async () => {
    const { wp, context } = setup({ featured_image: true });
    const result = await publishNote(context, NOTE, { kind: "draft" });
    expect(wp.posts.get(result.postId)!.featured_media).toBe([...wp.media.keys()][0]);
  });

  test("surfaces authentication errors and stores nothing", async () => {
    const { context, storage } = setup({ application_password: "wrong" });
    await expect(publishNote(context, NOTE, { kind: "draft" })).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect([...storage.keys()].filter((key) => key.startsWith("post:"))).toEqual([]);
  });

  test("rejects insecure site URLs before sending credentials", async () => {
    const { context, wp } = setup({ site_url: "http://blog.example.com" });
    await expect(publishNote(context, NOTE, { kind: "draft" })).rejects.toMatchObject({ kind: "config" });
    expect(wp.log).toEqual([]);
  });
});

test("testConnection returns the authenticated user", async () => {
  const { context } = setup();
  const { user, siteUrl } = await testConnection(context);
  expect(user.name).toBe("Editor");
  expect(siteUrl).toBe("https://blog.example.com");
});
