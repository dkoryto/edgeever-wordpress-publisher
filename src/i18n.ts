const en = {
  "command.publish": "Publish current note to WordPress",
  "command.draft": "Save current note as WordPress draft",
  "command.schedule": "Schedule current note…",
  "command.test": "Test WordPress connection",
  "panel.schedule.title": "Schedule on WordPress",
  "panel.schedule.label": "Publish date and time (your local time)",
  "panel.schedule.hint": "WordPress publishes the post at this time on its own, even when EdgeEver is closed.",
  "panel.schedule.submit": "Schedule post",
  "panel.schedule.cancel": "Cancel",
  "panel.schedule.working": "Scheduling…",
  "notice.noNote": "Open a note in the editor first.",
  "notice.working": "Sending “{title}” to WordPress…",
  "notice.created": "Created WordPress post ({status}): {link}",
  "notice.updated": "Updated WordPress post ({status}): {link}",
  "notice.recreated": "The earlier WordPress post no longer exists, so a new one was created ({status}): {link}",
  "notice.scheduledFor": " Scheduled for {date}.",
  "notice.mediaFailed": " {count} image(s) or attachment(s) could not be uploaded and were left out.",
  "notice.mediaSkipped": " {count} image(s) were not uploaded because image upload is turned off.",
  "notice.categories": " Categories not found or not creatable: {names}.",
  "notice.connected": "Connected to {site} as {user}.",
  "error.config": "WordPress Publisher is not set up: {message} Open the plugin settings to fix it.",
  "error.auth":
    "WordPress rejected the credentials ({status}): {message} Use your WordPress username and an Application Password (Users → Profile → Application Passwords), not your login password. The account also needs permission to publish posts and upload media.",
  "error.network":
    "Could not reach {site}. Check the URL and your connection. In the browser version, the site must allow cross-origin REST requests (WordPress does by default; some security plugins or proxies block them).",
  "error.invalidDate": "The date “{value}” is not valid. Use a format like 2026-10-12 09:30.",
  "error.pastDate": "Choose a date in the future.",
  "error.generic": "WordPress publish failed: {message}",
  "status.draft": "draft",
  "status.publish": "published",
  "status.future": "scheduled",
  "status.pending": "pending review",
  "status.private": "private",
} as const;

export type MessageKey = keyof typeof en;

const zhCN: Record<MessageKey, string> = {
  "command.publish": "将当前笔记发布到 WordPress",
  "command.draft": "将当前笔记保存为 WordPress 草稿",
  "command.schedule": "定时发布当前笔记…",
  "command.test": "测试 WordPress 连接",
  "panel.schedule.title": "定时发布到 WordPress",
  "panel.schedule.label": "发布日期和时间（本地时间）",
  "panel.schedule.hint": "WordPress 会在该时间自行发布文章，即使 EdgeEver 已关闭。",
  "panel.schedule.submit": "定时发布",
  "panel.schedule.cancel": "取消",
  "panel.schedule.working": "正在提交…",
  "notice.noNote": "请先在编辑器中打开一篇笔记。",
  "notice.working": "正在将“{title}”发送到 WordPress…",
  "notice.created": "已创建 WordPress 文章（{status}）：{link}",
  "notice.updated": "已更新 WordPress 文章（{status}）：{link}",
  "notice.recreated": "之前的 WordPress 文章已不存在，已重新创建（{status}）：{link}",
  "notice.scheduledFor": " 计划发布时间：{date}。",
  "notice.mediaFailed": " 有 {count} 个图片或附件上传失败，已从文章中略去。",
  "notice.mediaSkipped": " 图片上传已关闭，{count} 个图片未上传。",
  "notice.categories": " 以下分类不存在且无法创建：{names}。",
  "notice.connected": "已以 {user} 身份连接到 {site}。",
  "error.config": "WordPress Publisher 尚未配置：{message} 请打开插件设置进行修改。",
  "error.auth":
    "WordPress 拒绝了凭据（{status}）：{message} 请使用 WordPress 用户名和“应用程序密码”（用户 → 个人资料 → 应用程序密码），而不是登录密码。该账号还需要具备发布文章和上传媒体的权限。",
  "error.network":
    "无法连接 {site}。请检查网址和网络。在浏览器版本中，站点必须允许跨域 REST 请求（WordPress 默认允许，部分安全插件或代理会拦截）。",
  "error.invalidDate": "日期“{value}”无效。请使用类似 2026-10-12 09:30 的格式。",
  "error.pastDate": "请选择一个将来的时间。",
  "error.generic": "发布到 WordPress 失败：{message}",
  "status.draft": "草稿",
  "status.publish": "已发布",
  "status.future": "已定时",
  "status.pending": "待审核",
  "status.private": "私密",
};

const detectLocale = (): "en" | "zh-CN" => {
  const lang =
    (typeof document !== "undefined" && document.documentElement?.lang) ||
    (typeof navigator !== "undefined" && navigator.language) ||
    "en";
  return lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
};

export const t = (key: MessageKey, values: Record<string, string | number> = {}) => {
  const template = detectLocale() === "zh-CN" ? zhCN[key] : en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
};
