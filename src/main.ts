import { formatLocal, parseScheduleDate, toLocalInputValue } from "./dates";
import { t, type MessageKey } from "./i18n";
import { extractProperties } from "./markdown";
import { PublishInputError, publishNote, readSettings, testConnection, type PublishMode, type PublishResult } from "./publisher";
import type { EdgeEverNote, EdgeEverPlugin, PluginContext } from "./types";
import { WordPressError, normalizeSiteUrl } from "./wordpress";

const SCHEDULE_PANEL = "schedule";

/** The note open in the editor, including unsaved edits. */
const getActiveNote = async (context: PluginContext): Promise<EdgeEverNote | null> => {
  const document = await context.editor.getDocument();
  if (!document) return null;
  return readNote(context, document.noteId, document.contentMarkdown);
};

const readNote = async (context: PluginContext, noteId: string, liveMarkdown?: string): Promise<EdgeEverNote> => {
  const stored = await context.notes.get(noteId);
  return { id: noteId, title: stored.title, contentMarkdown: liveMarkdown ?? stored.contentMarkdown };
};

const statusLabel = (status: string) => {
  const key = `status.${status}` as MessageKey;
  return ["draft", "publish", "future", "pending", "private"].includes(status) ? t(key) : status;
};

export const describeResult = (result: PublishResult) => {
  const key: MessageKey = result.action === "created" ? "notice.created" : result.action === "updated" ? "notice.updated" : "notice.recreated";
  let message = t(key, { status: statusLabel(result.status), link: result.link });
  if (result.scheduledFor) message += t("notice.scheduledFor", { date: formatLocal(result.scheduledFor) });
  if (result.media.failed) message += t("notice.mediaFailed", { count: result.media.failed });
  if (result.media.skipped) message += t("notice.mediaSkipped", { count: result.media.skipped });
  if (result.unresolvedCategories.length) message += t("notice.categories", { names: result.unresolvedCategories.join(", ") });
  return message;
};

export const describeError = (error: unknown, siteUrl: string) => {
  if (error instanceof PublishInputError) {
    return error.code === "past_date" ? t("error.pastDate") : t("error.invalidDate", { value: error.message.match(/"(.*)"/)?.[1] ?? "" });
  }
  if (error instanceof WordPressError) {
    if (error.kind === "config") return t("error.config", { message: error.message });
    if (error.kind === "auth") return t("error.auth", { status: error.status, message: error.message });
    if (error.kind === "network") return t("error.network", { site: siteUrl || "WordPress" });
    return t("error.generic", { message: error.status ? `${error.message} (HTTP ${error.status})` : error.message });
  }
  return t("error.generic", { message: error instanceof Error ? error.message : String(error) });
};

const siteForMessages = async (context: PluginContext) => {
  try {
    return normalizeSiteUrl((await readSettings(context)).siteUrl);
  } catch {
    return "";
  }
};

const runPublish = async (context: PluginContext, note: EdgeEverNote, mode: PublishMode) => {
  try {
    context.ui.showNotice(t("notice.working", { title: note.title?.trim() || "Untitled" }));
    const result = await publishNote(context, note, mode);
    context.ui.showNotice(describeResult(result));
    return true;
  } catch (error) {
    context.ui.showNotice(describeError(error, await siteForMessages(context)));
    return false;
  }
};

const defaultScheduleDate = (markdown: string) => {
  const fromNote = extractProperties(markdown).properties.date;
  const parsed = fromNote ? parseScheduleDate(fromNote) : null;
  if (parsed && parsed.getTime() > Date.now()) return parsed;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
};

const mountSchedulePanel = (context: PluginContext): Parameters<PluginContext["ui"]["panels"]["register"]>[0]["mount"] =>
  (container, { state, requestClose, shell }) => {
    const { noteId, initial } = (state ?? {}) as { noteId?: string; initial?: string };
    shell.set({ header: { title: t("panel.schedule.title"), description: null } });

    const form = document.createElement("form");
    form.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:280px";
    const label = document.createElement("label");
    label.textContent = t("panel.schedule.label");
    label.style.cssText = "display:flex;flex-direction:column;gap:6px;font-weight:500";
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.required = true;
    input.value = initial ?? "";
    input.min = toLocalInputValue(new Date());
    input.style.cssText = "font:inherit;color:inherit;background:transparent;padding:6px 8px;border:1px solid rgba(127,127,127,.5);border-radius:6px";
    label.append(input);
    const hint = document.createElement("p");
    hint.textContent = t("panel.schedule.hint");
    hint.style.cssText = "margin:0;opacity:.75;font-size:.9em";
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.style.cssText = "margin:0;color:#c62828;font-size:.9em";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("panel.schedule.cancel");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = t("panel.schedule.submit");
    for (const button of [cancel, submit]) {
      button.style.cssText = "font:inherit;padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid rgba(127,127,127,.5);background:transparent;color:inherit";
    }
    submit.style.background = "#16A06E";
    submit.style.borderColor = "#16A06E";
    submit.style.color = "#fff";
    actions.append(cancel, submit);
    form.append(label, hint, error, actions);
    container.append(form);

    cancel.addEventListener("click", () => void requestClose());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      const date = parseScheduleDate(input.value);
      if (!date) {
        error.textContent = t("error.invalidDate", { value: input.value });
        return;
      }
      if (date.getTime() <= Date.now()) {
        error.textContent = t("error.pastDate");
        return;
      }
      if (!noteId) return;
      submit.disabled = true;
      submit.textContent = t("panel.schedule.working");
      try {
        const live = await context.editor.getDocument();
        const note = await readNote(context, noteId, live?.noteId === noteId ? live.contentMarkdown : undefined);
        if (await runPublish(context, note, { kind: "schedule", date })) await requestClose();
      } finally {
        submit.disabled = false;
        submit.textContent = t("panel.schedule.submit");
      }
    });
    queueMicrotask(() => input.focus());
    return () => form.remove();
  };

const plugin: EdgeEverPlugin = {
  activate(context) {
    const withActiveNote = (mode: PublishMode) => async () => {
      const note = await getActiveNote(context);
      if (!note) {
        context.ui.showNotice(t("notice.noNote"));
        return;
      }
      await runPublish(context, note, mode);
    };

    const disposers = [
      context.commands.register({ id: "publish-note", title: t("command.publish"), run: withActiveNote({ kind: "default" }) }),
      context.commands.register({ id: "save-draft", title: t("command.draft"), run: withActiveNote({ kind: "draft" }) }),
      context.commands.register({
        id: "schedule-note",
        title: t("command.schedule"),
        async run() {
          const note = await getActiveNote(context);
          if (!note) {
            context.ui.showNotice(t("notice.noNote"));
            return;
          }
          await context.ui.panels.open(SCHEDULE_PANEL, {
            state: { noteId: note.id, initial: toLocalInputValue(defaultScheduleDate(note.contentMarkdown)) },
          });
        },
      }),
      context.commands.register({
        id: "test-connection",
        title: t("command.test"),
        async run() {
          try {
            const { siteUrl, user } = await testConnection(context);
            context.ui.showNotice(t("notice.connected", { site: siteUrl, user: user.name || user.slug || String(user.id) }));
          } catch (error) {
            context.ui.showNotice(describeError(error, await siteForMessages(context)));
          }
        },
      }),
      context.ui.panels.register({
        id: SCHEDULE_PANEL,
        title: t("panel.schedule.title"),
        purpose: "workflow",
        presentation: "dialog",
        mount: mountSchedulePanel(context),
      }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  },
};

export default plugin;
