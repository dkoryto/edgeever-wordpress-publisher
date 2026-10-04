import { describe, expect, test } from "bun:test";
import plugin, { describeError } from "../src/main";
import type { PluginContext, PluginPanel } from "../src/types";
import { WordPressError } from "../src/wordpress";
import { createFakeContext, imageResource, PNG_BYTES } from "./fake-context";
import { createFakeWordPress } from "./fake-wordpress";

const createPluginContext = (options: { openNote?: boolean; password?: string } = {}) => {
  const wp = createFakeWordPress();
  const { context: core } = createFakeContext({
    fetch: wp.fetch,
    settings: { site_url: "https://blog.example.com", username: "editor", application_password: options.password ?? "app pass", default_status: "publish" },
    resources: [imageResource("res_img", "note_1", PNG_BYTES)],
  });
  const commands = new Map<string, () => void | Promise<void>>();
  const panels = new Map<string, PluginPanel>();
  const notices: string[] = [];
  const opened: Array<{ id: string; state: unknown }> = [];
  const markdown = "# Title\n\nLive ![x](/api/v1/resources/res_img/blob)";
  const context: PluginContext = {
    ...core,
    pluginId: "com.silevis.wordpress-publisher",
    notes: { get: async (id) => ({ id, title: "Title", contentMarkdown: "stale" }) },
    editor: { getDocument: async () => (options.openNote === false ? null : { noteId: "note_1", contentMarkdown: markdown, hasUnsavedChanges: true }) },
    commands: { register: (command) => { commands.set(command.id, command.run); return () => commands.delete(command.id); } },
    ui: {
      showNotice: (message) => notices.push(message),
      panels: {
        register: (panel) => { panels.set(panel.id, panel); return () => panels.delete(panel.id); },
        open: async (id, openOptions) => { opened.push({ id, state: openOptions?.state }); },
      },
    },
  };
  return { wp, context, commands, panels, notices, opened };
};

describe("plugin entry", () => {
  test("registers the four commands and the schedule panel, and disposes them", async () => {
    const { context, commands, panels } = createPluginContext();
    const dispose = await plugin.activate(context);
    expect([...commands.keys()]).toEqual(["publish-note", "save-draft", "schedule-note", "test-connection"]);
    expect(panels.get("schedule")?.purpose).toBe("workflow");
    (dispose as () => void)();
    expect(commands.size).toBe(0);
    expect(panels.size).toBe(0);
  });

  test("publishes the live editor content and shows the post link", async () => {
    const { context, commands, notices, wp } = createPluginContext();
    await plugin.activate(context);
    await commands.get("publish-note")!();
    const post = [...wp.posts.values()][0];
    expect(post.status).toBe("publish");
    expect(post.content).toContain("Live");
    expect(post.content).toContain("wp-content/uploads/res_img.png");
    expect(notices.at(-1)).toContain(`https://blog.example.com/?p=${post.id}`);
  });

  test("asks for an open note", async () => {
    const { context, commands, notices } = createPluginContext({ openNote: false });
    await plugin.activate(context);
    await commands.get("save-draft")!();
    expect(notices).toEqual(["Open a note in the editor first."]);
  });

  test("opens the schedule dialog for the active note", async () => {
    const { context, commands, opened } = createPluginContext();
    await plugin.activate(context);
    await commands.get("schedule-note")!();
    expect(opened[0].id).toBe("schedule");
    expect(opened[0].state).toMatchObject({ noteId: "note_1" });
    expect((opened[0].state as { initial: string }).initial).toMatch(/^\d{4}-\d{2}-\d{2}T09:00$/);
  });

  test("explains Application Passwords on authentication failures", async () => {
    const { context, commands, notices } = createPluginContext({ password: "wrong" });
    await plugin.activate(context);
    await commands.get("test-connection")!();
    expect(notices.at(-1)).toContain("Application Password");
    expect(notices.at(-1)).toContain("401");
  });

  test("describes network errors", () => {
    expect(describeError(new WordPressError("network", "x"), "https://blog.example.com")).toContain("Could not reach https://blog.example.com");
  });
});

test("built main.js is a self-contained module with a default export", async () => {
  const proc = Bun.spawnSync(["bun", "run", "build"], { cwd: `${import.meta.dir}/..` });
  expect(proc.exitCode).toBe(0);
  const source = await Bun.file(`${import.meta.dir}/../main.js`).text();
  expect(source).not.toMatch(/^\s*import\s/m);
  const module = await import(`${import.meta.dir}/../main.js`);
  expect(typeof module.default.activate).toBe("function");
});
