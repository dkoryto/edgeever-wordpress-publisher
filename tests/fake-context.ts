import type { EdgeEverResource, FetchLike, PublisherContext, SettingValue } from "../src/types";

export interface FakeResource {
  meta: EdgeEverResource;
  bytes: Uint8Array<ArrayBuffer>;
}

/** In-memory EdgeEver plugin context for the publishing core. */
export const createFakeContext = (options: {
  fetch: FetchLike;
  settings: Record<string, SettingValue>;
  resources?: FakeResource[];
}) => {
  const storage = new Map<string, unknown>();
  const resources = options.resources ?? [];
  const reads: string[] = [];
  const context: PublisherContext = {
    network: { fetch: options.fetch },
    storage: {
      async get<T>(key: string) {
        return storage.has(key) ? (structuredClone(storage.get(key)) as T) : null;
      },
      async set<T>(key: string, value: T) {
        storage.set(key, structuredClone(value));
      },
      async remove(key: string) {
        storage.delete(key);
      },
    },
    settings: {
      async get(key: string) {
        return key in options.settings ? options.settings[key] : null;
      },
    },
    resources: {
      async list(noteId?: string) {
        return resources.filter((resource) => !noteId || resource.meta.noteId === noteId).map((resource) => resource.meta);
      },
      async read(resourceId: string) {
        reads.push(resourceId);
        const resource = resources.find((entry) => entry.meta.id === resourceId);
        if (!resource) throw new Error(`Resource ${resourceId} not found`);
        return new Blob([resource.bytes], { type: resource.meta.mimeType ?? "" });
      },
    },
  };
  return { context, storage, reads };
};

export const imageResource = (id: string, noteId: string, bytes: Uint8Array<ArrayBuffer>, contentHash = `hash-${id}`): FakeResource => ({
  meta: {
    id,
    noteId,
    kind: "image",
    mimeType: "image/png",
    filename: `${id}.png`,
    byteSize: bytes.byteLength,
    contentHash,
    url: `/api/v1/resources/${id}/blob`,
  },
  bytes,
});

/** 1x1 transparent PNG. */
export const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);
