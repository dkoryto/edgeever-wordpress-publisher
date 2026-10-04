import { parseScheduleDate, toWordPressGmt } from "./dates";
import { collectResourceReferences, markdownToHtml, prepareNote } from "./markdown";
import type { EdgeEverNote, EdgeEverResource, PublisherContext } from "./types";
import {
  WordPressClient,
  WordPressError,
  safeFilename,
  type PostPayload,
  type PostStatus,
  type WordPressPost,
} from "./wordpress";

export const SETTING_KEYS = {
  siteUrl: "site_url",
  username: "username",
  applicationPassword: "application_password",
  defaultStatus: "default_status",
  categories: "default_categories",
  uploadImages: "upload_images",
  featuredImage: "featured_image",
} as const;

export interface PublisherSettings {
  siteUrl: string;
  username: string;
  applicationPassword: string;
  defaultStatus: "draft" | "publish";
  categories: string;
  uploadImages: boolean;
  featuredImage: boolean;
}

export const readSettings = async (context: PublisherContext): Promise<PublisherSettings> => {
  const get = (key: string) => context.settings.get(key);
  const [siteUrl, username, applicationPassword, defaultStatus, categories, uploadImages, featuredImage] = await Promise.all([
    get(SETTING_KEYS.siteUrl),
    get(SETTING_KEYS.username),
    get(SETTING_KEYS.applicationPassword),
    get(SETTING_KEYS.defaultStatus),
    get(SETTING_KEYS.categories),
    get(SETTING_KEYS.uploadImages),
    get(SETTING_KEYS.featuredImage),
  ]);
  return {
    siteUrl: typeof siteUrl === "string" ? siteUrl : "",
    username: typeof username === "string" ? username : "",
    applicationPassword: typeof applicationPassword === "string" ? applicationPassword : "",
    defaultStatus: defaultStatus === "publish" ? "publish" : "draft",
    categories: typeof categories === "string" ? categories : "",
    uploadImages: typeof uploadImages === "boolean" ? uploadImages : true,
    featuredImage: featuredImage === true,
  };
};

export const createClient = (context: PublisherContext, settings: PublisherSettings) =>
  new WordPressClient(
    { siteUrl: settings.siteUrl, username: settings.username, applicationPassword: settings.applicationPassword },
    (input, init) => context.network.fetch(input, init),
  );

/** Remembered link between an EdgeEver note and a WordPress post. */
export interface PostLink {
  postId: number;
  siteUrl: string;
  link: string;
  status: PostStatus;
  updatedAt: string;
}

interface MediaLink {
  mediaId: number;
  sourceUrl: string;
}

export const postStorageKey = (siteUrl: string, noteId: string) => `post:${siteUrl}:${noteId}`;
const mediaStorageKey = (siteUrl: string, resourceId: string, contentHash: string | null) =>
  `media:${siteUrl}:${resourceId}:${contentHash ?? "unknown"}`;

export type PublishMode =
  | { kind: "default" }
  | { kind: "draft" }
  | { kind: "schedule"; date: Date };

export interface PublishResult {
  postId: number;
  link: string;
  status: PostStatus;
  /** created: first publish; updated: existing post; recreated: remote post was gone. */
  action: "created" | "updated" | "recreated";
  scheduledFor: Date | null;
  media: { uploaded: number; reused: number; failed: number; skipped: number };
  unresolvedCategories: string[];
}

export class PublishInputError extends Error {
  constructor(readonly code: "invalid_date" | "past_date", message: string) {
    super(message);
    this.name = "PublishInputError";
  }
}

const parseCategoryList = (value: string) =>
  value.split(/[,，]/).map((entry) => entry.trim()).filter(Boolean);

/** Resolves category names or numeric IDs. Missing names are created when the user is allowed to. */
export const resolveCategories = async (client: WordPressClient, value: string) => {
  const ids: number[] = [];
  const unresolved: string[] = [];
  for (const entry of parseCategoryList(value)) {
    if (/^\d+$/.test(entry)) {
      ids.push(Number(entry));
      continue;
    }
    try {
      const matches = await client.searchCategories(entry);
      const match = matches.find((category) => decodeEntities(category.name).toLowerCase() === entry.toLowerCase());
      if (match) {
        ids.push(match.id);
        continue;
      }
      const created = await client.createCategory(entry);
      ids.push(created.id);
    } catch (error) {
      if (error instanceof WordPressError && error.code === "term_exists") {
        const existing = error.data?.term_id;
        if (typeof existing === "number") {
          ids.push(existing);
          continue;
        }
      }
      if (error instanceof WordPressError && error.kind === "network") throw error;
      unresolved.push(entry);
    }
  }
  return { ids: [...new Set(ids)], unresolved };
};

const decodeEntities = (value: string) =>
  value.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

interface MediaUploadSummary {
  urls: Map<string, string>;
  firstImageMediaId: number | null;
  uploaded: number;
  reused: number;
  failed: number;
  skipped: number;
}

/** Uploads referenced note resources to the Media Library, reusing earlier uploads of the same bytes. */
export const uploadNoteResources = async (
  context: PublisherContext,
  client: WordPressClient,
  noteId: string,
  markdown: string,
): Promise<MediaUploadSummary> => {
  const summary: MediaUploadSummary = { urls: new Map(), firstImageMediaId: null, uploaded: 0, reused: 0, failed: 0, skipped: 0 };
  const references = collectResourceReferences(markdown);
  if (references.length === 0) return summary;

  let metadata: EdgeEverResource[] = [];
  try {
    metadata = await context.resources.list(noteId);
  } catch {
    metadata = [];
  }
  const byId = new Map(metadata.map((resource) => [resource.id, resource]));

  for (const reference of references) {
    const resource = byId.get(reference.resourceId);
    const cacheKey = mediaStorageKey(client.siteUrl, reference.resourceId, resource?.contentHash ?? null);
    try {
      const cached = resource?.contentHash ? await context.storage.get<MediaLink>(cacheKey) : null;
      if (cached) {
        try {
          const media = await client.getMedia(cached.mediaId);
          summary.urls.set(reference.resourceId, media.source_url);
          if (reference.kind === "image" && summary.firstImageMediaId === null) summary.firstImageMediaId = media.id;
          summary.reused += 1;
          continue;
        } catch (error) {
          if (!(error instanceof WordPressError && error.kind === "not_found")) throw error;
          await context.storage.remove(cacheKey);
        }
      }

      const blob = await context.resources.read(reference.resourceId);
      const mimeType = resource?.mimeType || blob.type || "application/octet-stream";
      const filename = safeFilename(resource?.filename, mimeType, `edgeever-${reference.resourceId}`);
      const media = await client.uploadMedia(blob, filename, mimeType);
      summary.urls.set(reference.resourceId, media.source_url);
      if (reference.kind === "image" && summary.firstImageMediaId === null) summary.firstImageMediaId = media.id;
      summary.uploaded += 1;
      if (resource?.contentHash) {
        await context.storage.set<MediaLink>(cacheKey, { mediaId: media.id, sourceUrl: media.source_url });
      }
    } catch (error) {
      // Authentication and connectivity problems affect the whole publish; surface them.
      if (error instanceof WordPressError && (error.kind === "network" || (error.kind === "auth" && error.status === 401))) throw error;
      summary.failed += 1;
    }
  }
  return summary;
};

const resolveSchedule = (mode: PublishMode, propertyDate: string | undefined, now: Date) => {
  if (mode.kind === "schedule") {
    if (Number.isNaN(mode.date.getTime())) throw new PublishInputError("invalid_date", "Invalid schedule date.");
    if (mode.date.getTime() <= now.getTime()) throw new PublishInputError("past_date", "The schedule date must be in the future.");
    return mode.date;
  }
  if (!propertyDate) return null;
  const parsed = parseScheduleDate(propertyDate);
  if (!parsed) throw new PublishInputError("invalid_date", `Cannot read wordpress_date "${propertyDate}".`);
  return parsed;
};

/**
 * Publishes one note. The note is created on first publish and updated on later
 * publishes (tracked per site in plugin storage); if the remembered post was
 * deleted in WordPress, a new post is created.
 */
export const publishNote = async (
  context: PublisherContext,
  note: EdgeEverNote,
  mode: PublishMode,
  options: { now?: Date; settings?: PublisherSettings } = {},
): Promise<PublishResult> => {
  const now = options.now ?? new Date();
  const settings = options.settings ?? (await readSettings(context));
  const client = createClient(context, settings);
  const prepared = prepareNote(note);
  const scheduledDate = resolveSchedule(mode, prepared.properties.date, now);

  let status: PostStatus;
  if (mode.kind === "draft") status = "draft";
  else if (mode.kind === "schedule") status = "future";
  else status = settings.defaultStatus;
  // A future `wordpress_date` in the note is an explicit request to schedule.
  if (mode.kind === "default" && scheduledDate && scheduledDate.getTime() > now.getTime()) status = "future";

  const media = settings.uploadImages
    ? await uploadNoteResources(context, client, note.id, prepared.markdown)
    : { urls: new Map<string, string>(), firstImageMediaId: null, uploaded: 0, reused: 0, failed: 0, skipped: collectResourceReferences(prepared.markdown).length };

  const categories = await resolveCategories(client, prepared.properties.categories ?? settings.categories);

  const key = postStorageKey(client.siteUrl, note.id);
  const existing = await context.storage.get<PostLink>(key);
  // Publishing a previously scheduled post without a date means "publish now";
  // otherwise WordPress would keep the old future date and the post stays scheduled.
  const effectiveDate = scheduledDate ?? (status === "publish" && existing?.status === "future" ? now : null);

  const payload: PostPayload = {
    title: prepared.title,
    content: markdownToHtml(prepared.markdown, { resourceUrls: media.urls }),
    status,
    ...(effectiveDate ? { date_gmt: toWordPressGmt(effectiveDate) } : {}),
    ...(categories.ids.length ? { categories: categories.ids } : {}),
    ...(settings.featuredImage && media.firstImageMediaId !== null ? { featured_media: media.firstImageMediaId } : {}),
  };

  let post: WordPressPost;
  let action: PublishResult["action"];
  if (existing && existing.siteUrl === client.siteUrl) {
    try {
      post = await client.updatePost(existing.postId, payload);
      action = "updated";
    } catch (error) {
      // 404 = deleted permanently; 410 = already in the trash and cannot be edited.
      const gone = error instanceof WordPressError && (error.status === 404 || error.status === 410);
      if (!gone) throw error;
      post = await client.createPost(payload);
      action = "recreated";
    }
  } else {
    post = await client.createPost(payload);
    action = "created";
  }

  await context.storage.set<PostLink>(key, {
    postId: post.id,
    siteUrl: client.siteUrl,
    link: post.link,
    status: post.status,
    updatedAt: now.toISOString(),
  });

  return {
    postId: post.id,
    link: post.link,
    status: post.status,
    action,
    scheduledFor: post.status === "future" ? scheduledDate : null,
    media: { uploaded: media.uploaded, reused: media.reused, failed: media.failed, skipped: media.skipped },
    unresolvedCategories: categories.unresolved,
  };
};

/** Verifies the credentials by reading the authenticated user. */
export const testConnection = async (context: PublisherContext) => {
  const settings = await readSettings(context);
  const client = createClient(context, settings);
  const user = await client.getCurrentUser();
  return { siteUrl: client.siteUrl, user };
};
