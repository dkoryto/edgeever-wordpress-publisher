/**
 * Minimal structural types for the subset of the EdgeEver plugin context (API v2)
 * used by this plugin. They mirror the public contract documented in
 * docs/plugin-development.md. When `@edgeever/plugin-api` is available from a
 * package registry, these can be replaced by its exported `PluginContext`.
 */

export type SettingValue = string | number | boolean;

export interface EdgeEverNote {
  id: string;
  title: string | null;
  contentMarkdown: string;
}

export interface EdgeEverResource {
  id: string;
  noteId: string;
  kind: "image" | "attachment";
  mimeType: string | null;
  filename: string | null;
  byteSize: number;
  contentHash: string | null;
  url: string;
}

export interface PanelAction {
  id: string;
  label: string;
  variant?: "default" | "primary" | "ghost";
  disabled?: boolean;
}

export interface PanelMountContext {
  state: unknown;
  requestClose(): Promise<void>;
  shell: { set(chrome: { header?: { title?: string; description?: string | null; actions?: PanelAction[] }; onAction?(id: string): void }): void };
}

export interface PluginPanel {
  id: string;
  title: string;
  purpose: "workflow" | "dashboard" | "preview" | "onboarding";
  presentation?: "dialog" | "fullscreen";
  mount(container: HTMLElement, context: PanelMountContext): void | (() => void) | Promise<void | (() => void)>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The parts of the plugin context the publishing core depends on. */
export interface PublisherContext {
  network: { fetch: FetchLike };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
  };
  settings: { get(key: string): Promise<SettingValue | null> };
  resources: {
    list(noteId?: string): Promise<EdgeEverResource[]>;
    read(resourceId: string): Promise<Blob>;
  };
}

export interface PluginContext extends PublisherContext {
  pluginId: string;
  notes: { get(noteId: string): Promise<EdgeEverNote> };
  editor: {
    getDocument(): Promise<{ noteId: string; contentMarkdown: string; hasUnsavedChanges: boolean } | null>;
  };
  commands: {
    register(command: { id: string; title: string; listed?: boolean; menu?: boolean; run: () => void | Promise<void> }): () => void;
  };
  ui: {
    showNotice(message: string): void;
    panels: {
      register(panel: PluginPanel): () => void;
      open(panelId: string, options?: { state?: unknown }): Promise<void>;
    };
  };
}

export interface EdgeEverPlugin {
  activate(context: PluginContext): void | (() => void) | Promise<void | (() => void)>;
}
