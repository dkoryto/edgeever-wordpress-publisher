# WordPress Publisher for EdgeEver

[English](#english) · [简体中文](#简体中文)

An [EdgeEver](https://github.com/tianma-if/edgeever) plugin that publishes the current note to a WordPress site through the WordPress REST API. It can save drafts, publish, schedule, and update the same post when you publish again. Note images are uploaded to the WordPress Media Library. (Upstream request: tianma-if/edgeever#105.)

---

## English

### Features

- **Publish, save as draft, or schedule** the note open in the editor, including unsaved edits.
- **Updates instead of duplicates.** The plugin remembers which WordPress post belongs to each note (per site). Publishing again updates that post. If the post was deleted in WordPress, a new one is created.
- **Images go to the Media Library.** Images (and linked attachments) stored in EdgeEver are uploaded once, and the post links to the WordPress copies. Unchanged images are reused on later publishes.
- **Markdown to HTML** with [marked](https://marked.js.org/) (GFM: tables, task lists, strikethrough). Raw HTML in notes is shown as text, except simple formatting tags (`<u>`, `<mark>`, `<sub>`, `<sup>`, `<kbd>`, `<details>`…), so the plugin never sends scripts, event handlers or iframes. `javascript:` and `data:` links are removed.
- A leading `# Heading` that repeats the note title is dropped, because WordPress shows the title itself.
- Optional default categories, and an option to use the first image as the featured image.

### Requirements

- EdgeEver Web or desktop with plugin support (plugin API v2). The Android and iOS apps do not run plugins.
- WordPress 5.6 or later (Application Passwords are built in) on **HTTPS**. Plain `http://` is accepted only for `localhost`.
- A WordPress account that can publish posts and upload media (for example the Author, Editor or Administrator role).

### Installation

1. In EdgeEver, open the **Plugin Marketplace** page.
2. Paste the repository URL, for example `https://github.com/<owner>/edgeever-wordpress-publisher`, and install.
3. Confirm the community-plugin trust prompt and enable the plugin.

### Setup: create an Application Password

Application Passwords let the plugin sign in to WordPress without your real password, and you can revoke them at any time.

1. Sign in to WordPress admin and open **Users → Profile** (or **Users → All Users → your user**).
2. Scroll to **Application Passwords**, enter a name such as `EdgeEver`, and click **Add New Application Password**.
3. Copy the generated password (it looks like `abcd EFGH 1234 ijkl MNOP 5678`). WordPress shows it only once. The spaces are optional.
4. In EdgeEver, open the plugin's **Settings** page and fill in:

| Setting | Description |
| --- | --- |
| WordPress site URL | For example `https://blog.example.com`. If WordPress is in a subfolder, include it (`https://example.com/blog`). |
| WordPress username | The login name of the account that owns the Application Password. |
| Application Password | The password from step 3. It is kept in EdgeEver's encrypted, device-local Secret Storage. |
| Default post status | `Draft` (default) or `Published`. Used by **Publish current note to WordPress**. |
| Default categories | Optional, comma-separated names or IDs, for example `News, 12`. If a name does not exist and your account may manage categories, the plugin creates it. |
| Upload note images to the Media Library | On by default. When off, images are left out of the post (their alt text is kept). |
| Use the first image as the featured image | Off by default. |

5. Run **Test WordPress connection**. It reads `GET /wp-json/wp/v2/users/me` and shows the signed-in user.

If the Application Passwords section is missing, your site may have turned the feature off (some security plugins do), or the site is not served over HTTPS.

### Commands

| Command | What it does |
| --- | --- |
| **Publish current note to WordPress** | Creates or updates the post using the *Default post status* setting. If the note has a future `wordpress_date`, the post is scheduled instead. |
| **Save current note as WordPress draft** | Creates or updates the post as a draft. A post that was already published goes back to draft. |
| **Schedule current note…** | Opens a dialog to pick a date and time (your local time), then creates or updates the post with status *Scheduled* (`future`). |
| **Test WordPress connection** | Checks the URL and credentials. |

Each command shows a notice with the result and the post link. If an image or attachment cannot be uploaded, the plugin keeps going and the notice says how many were left out.

### Scheduling

Scheduling uses WordPress's own scheduled posts (`status: "future"` with a `date_gmt`). After you schedule, **WordPress publishes the post at that time by itself, even when EdgeEver is closed**. We did not use EdgeEver's plugin schedules for this because they run only while the desktop app is open on one device.

There are two ways to set the date:

1. **Schedule current note…**: pick the date and time in the dialog.
2. **A property in the note**: add a line like this (on its own line, anywhere in the note) or put it in front matter at the top:

   ```text
   wordpress_date: 2026-10-12 09:30
   ```

   Accepted formats: `2026-10-12`, `2026-10-12 09:30`, `2026-10-12T09:30:00`, with an optional offset (`Z`, `+02:00`). Without an offset, the date uses your device's time zone, and a date with no time means 09:00. When you run **Publish current note to WordPress**, a future date schedules the post, and a past date is used as the post date (backdating). **Save current note as WordPress draft** keeps the post as a draft but still sets its date. The property line is removed from the published content. The dialog also starts from this date when it is set.

You can also set `wordpress_categories: News, Releases` the same way to override the default categories for one note.

### How updates are tracked

The plugin stores `note ID + site URL → post ID` in EdgeEver plugin storage. This storage is local to the device and workspace, so publishing the same note from another device creates a separate post. Changing the site URL starts a new set of posts. Uploaded images are remembered by resource ID and content hash, and checked again before they are reused.

### Privacy and network access

The plugin sends the note title, the HTML content, referenced images and attachments, and your credentials only to the WordPress site you configure. It uses no other service. Requests are sent with `credentials: "omit"`, so browser cookies are never used for authentication.

In the **Web** version, requests come from your browser, so the WordPress site must allow cross-origin REST requests. WordPress core allows them by default, including the `Authorization` header. Some security plugins, CDNs or proxies block them or remove the `Authorization` header. The desktop app does not have this restriction.

### Permissions declared

`notes:read`, `editor:read`, `resources:read`, `network`, `storage`, `ui:commands`, `ui:notices`, `ui:panels`. In EdgeEver these declarations describe what the plugin uses. They are not a sandbox.

### Limitations

- Only one note at a time, the one open in the editor. There is no bulk publishing.
- No two-way sync. Edits made in WordPress are overwritten the next time you publish from EdgeEver.
- Notes are converted to classic HTML, not Gutenberg blocks. WordPress shows the content in a *Classic* block, and it can be converted to blocks in the editor.
- No tags, excerpts, slugs, custom post types or post formats yet.
- Only images and attachments stored in this EdgeEver workspace are uploaded. External image URLs are kept as they are. WordPress may reject some attachment types (for example `.zip`) depending on its upload settings. These are counted as failed in the notice.
- EdgeEver plugin embeds (drawings and similar) are left out because they only render inside EdgeEver.
- EdgeEver does not render YAML front matter specially. In the editor, a standalone `wordpress_date: …` line is the most reliable form.
- Settings, the Application Password and the note-to-post map are stored per device. They do not sync.
- Notices are plain text, so the post link is shown but may not be clickable.

### Development

```sh
bun install
bun run typecheck
bun run test        # unit tests (bun:test)
bun run build       # writes main.js (single-file ESM bundle, no imports)
bun run test:e2e    # needs Docker: real WordPress + MariaDB on 127.0.0.1:8089
```

- `src/markdown.ts`: properties, Markdown to HTML, resource URL rewriting.
- `src/wordpress.ts`: REST client (Application Password Basic auth, error classification, `?rest_route=` fallback for sites without pretty permalinks).
- `src/publisher.ts`: the publishing core used by the commands (media upload, categories, create/update/recreate).
- `src/main.ts`: the plugin entry (commands, schedule dialog, notices in English and Simplified Chinese).
- `src/types.ts`: minimal types for the EdgeEver plugin context, taken from the public plugin API docs.
- `e2e/`: `run.sh` starts `wordpress:latest` + `mariadb:11` with Docker Compose, installs WordPress with `wordpress:cli`, creates an Application Password, and runs `wordpress.e2e.ts`. That test drives the publishing core with an in-memory EdgeEver context (a Markdown note plus one PNG resource). It runs once with plain permalinks and once with pretty permalinks, then removes all containers and data. Set `KEEP_WORDPRESS=1` to keep the site running, or `WP_PORT` to use a different port.

### Releasing

EdgeEver installs GitHub plugins from the default branch's `manifest.json` and the matching GitHub Release.

1. Bump `version` in both `package.json` and `manifest.json`. The build fails if they differ. Commit to the default branch.
2. Push a tag `X.Y.Z` or `vX.Y.Z`. `.github/workflows/release.yml` tests, builds and attaches `manifest.json` and `main.js` to the Release.
3. The Release `manifest.json` must match the default-branch file exactly, so do not edit the manifest after tagging.

Bundled third-party code: [marked](https://github.com/markedjs/marked) (MIT). Its license notice is kept at the top of `main.js`.

### License

MIT. See [LICENSE](LICENSE).

---

## 简体中文

### 功能

- 将编辑器中打开的笔记（包括尚未保存的修改）**发布、保存为草稿或定时发布**到 WordPress。
- **再次发布时更新原文章，不会重复创建。** 插件按站点记住每篇笔记对应的 WordPress 文章，再次发布即更新该文章；如果文章已在 WordPress 中删除，则重新创建。
- **图片上传到媒体库。** 存储在 EdgeEver 中的图片（以及链接的附件）只上传一次，文章中引用 WordPress 上的副本；之后发布时，未变化的图片会直接复用。
- 使用 [marked](https://marked.js.org/) 将 **Markdown 转为 HTML**（支持 GFM：表格、任务列表、删除线）。笔记中的原始 HTML 会以文本形式显示，只保留简单的格式标签（`<u>`、`<mark>`、`<sub>`、`<sup>`、`<kbd>`、`<details>` 等），因此插件不会发送脚本、事件属性或 iframe；`javascript:`、`data:` 链接会被移除。
- 如果笔记开头的 `# 标题` 与笔记标题相同，会被去掉，因为 WordPress 会自行显示标题。
- 可设置默认分类，也可将第一张图片设为特色图片。

### 要求

- 支持插件（插件 API v2）的 EdgeEver Web 或桌面端。Android 和 iOS 客户端不运行插件。
- WordPress 5.6 及以上（内置应用程序密码），并使用 **HTTPS**。仅 `localhost` 可使用 `http://`。
- WordPress 账号需要能发布文章和上传媒体（例如作者、编辑或管理员角色）。

### 安装

1. 在 EdgeEver 中打开 **插件市场** 页面。
2. 粘贴仓库地址，例如 `https://github.com/<owner>/edgeever-wordpress-publisher`，然后安装。
3. 确认社区插件信任提示，并启用插件。

### 配置：创建应用程序密码

插件使用应用程序密码登录 WordPress，无需提供真实密码，并且可以随时撤销。

1. 登录 WordPress 后台，打开 **用户 → 个人资料**（或 **用户 → 所有用户 → 你的账号**）。
2. 找到 **应用程序密码**，输入名称（如 `EdgeEver`），点击 **添加新应用程序密码**。
3. 复制生成的密码（形如 `abcd EFGH 1234 ijkl MNOP 5678`）。该密码只显示一次，空格可有可无。
4. 在 EdgeEver 中打开插件的 **设置** 页面并填写：

| 设置 | 说明 |
| --- | --- |
| WordPress 站点网址 | 例如 `https://blog.example.com`。如果 WordPress 安装在子目录中，请带上子目录（`https://example.com/blog`）。 |
| WordPress 用户名 | 创建应用程序密码的账号的登录名。 |
| 应用程序密码 | 第 3 步生成的密码，加密保存在 EdgeEver 本机的安全存储中。 |
| 默认文章状态 | `草稿`（默认）或 `已发布`，用于“将当前笔记发布到 WordPress”命令。 |
| 默认分类 | 可选，以逗号分隔的分类名称或 ID，例如 `新闻, 12`。如果分类不存在且账号有管理分类的权限，插件会自动创建。 |
| 将笔记图片上传到媒体库 | 默认开启。关闭后文章中不包含图片（保留替代文本）。 |
| 将第一张图片设为特色图片 | 默认关闭。 |

5. 运行 **测试 WordPress 连接**。该命令会请求 `GET /wp-json/wp/v2/users/me`，并显示当前登录的用户。

如果找不到“应用程序密码”，可能是站点关闭了该功能（部分安全插件会这样做），或站点没有使用 HTTPS。

### 命令

| 命令 | 作用 |
| --- | --- |
| **将当前笔记发布到 WordPress** | 按“默认文章状态”创建或更新文章。如果笔记中设置了将来的 `wordpress_date`，则改为定时发布。 |
| **将当前笔记保存为 WordPress 草稿** | 以草稿形式创建或更新文章。已发布的文章会变回草稿。 |
| **定时发布当前笔记…** | 打开对话框选择日期和时间（本地时间），然后以“已定时”（`future`）状态创建或更新文章。 |
| **测试 WordPress 连接** | 检查网址和凭据。 |

每个命令都会以通知显示结果和文章链接。如果某个图片或附件上传失败，插件会继续发布，并在通知中说明有几个被略去。

### 定时发布

定时发布使用 WordPress 自带的定时文章功能（`status: "future"` 加 `date_gmt`）。提交后，**WordPress 会在设定时间自行发布文章，即使 EdgeEver 已关闭**。这里没有使用 EdgeEver 的插件计划任务，因为它只在某一台设备的桌面端打开时才会运行。

设置时间有两种方式：

1. 使用 **定时发布当前笔记…**，在对话框中选择日期和时间。
2. 在笔记中添加属性：在笔记任意位置单独写一行（或写在顶部的 front matter 中）：

   ```text
   wordpress_date: 2026-10-12 09:30
   ```

   支持的格式：`2026-10-12`、`2026-10-12 09:30`、`2026-10-12T09:30:00`，可附带时区偏移（`Z`、`+08:00`）。不带偏移时按本机时区计算；只写日期时默认为 09:00。运行“将当前笔记发布到 WordPress”时，将来的时间会定时发布，过去的时间则作为文章日期（补发）。“保存为草稿”仍保持草稿状态，但同样会设置文章日期。这一行不会出现在发布的内容中。设置了该属性时，对话框也会以它作为初始时间。

同样可以写 `wordpress_categories: 新闻, 发布` 来为单篇笔记指定分类，覆盖默认分类。

### 更新记录方式

插件在 EdgeEver 插件存储中保存“笔记 ID + 站点网址 → 文章 ID”。该存储只属于当前设备和工作区，因此在另一台设备上发布同一篇笔记会创建另一篇文章；更换站点网址后也会创建新的文章。已上传的图片按资源 ID 和内容哈希记录，复用前会再次确认它仍然存在。

### 隐私与网络访问

插件只会把笔记标题、HTML 内容、引用的图片和附件以及你的凭据发送到你配置的 WordPress 站点，不使用任何其他服务。请求使用 `credentials: "omit"`，因此不会使用浏览器 Cookie 进行认证。

在 **Web 版** 中，请求从浏览器发出，WordPress 站点必须允许跨域 REST 请求。WordPress 默认允许，包括 `Authorization` 请求头；但部分安全插件、CDN 或代理会拦截这类请求，或去掉 `Authorization` 请求头。桌面端没有这个限制。

### 声明的权限

`notes:read`、`editor:read`、`resources:read`、`network`、`storage`、`ui:commands`、`ui:notices`、`ui:panels`。在 EdgeEver 中，这些声明用于说明插件会用到什么，并不是沙箱。

### 限制

- 一次只能发布编辑器中打开的那一篇笔记，不支持批量发布。
- 不支持双向同步。在 WordPress 中所做的修改会在下次从 EdgeEver 发布时被覆盖。
- 内容转换为经典 HTML，而不是古腾堡区块。WordPress 会把它显示在“经典”区块中，可以在编辑器中转换为区块。
- 暂不支持标签、摘要、别名、自定义文章类型和文章格式。
- 只上传存储在当前 EdgeEver 工作区中的图片和附件；外部图片网址保持不变。WordPress 可能根据上传设置拒绝某些附件类型（如 `.zip`），这些会在通知中计为失败。
- EdgeEver 插件嵌入内容（如绘图）只能在 EdgeEver 中显示，因此不会发布。
- EdgeEver 不会专门处理 YAML front matter。在编辑器中，单独一行 `wordpress_date: …` 是最可靠的写法。
- 设置、应用程序密码和笔记与文章的对应关系都只保存在当前设备上，不会同步。
- 通知是纯文本，会显示文章链接，但可能无法点击。

### 开发

```sh
bun install
bun run typecheck
bun run test        # 单元测试（bun:test）
bun run build       # 生成 main.js（单文件 ESM，不含 import）
bun run test:e2e    # 需要 Docker：在 127.0.0.1:8089 启动真实的 WordPress + MariaDB
```

`e2e/run.sh` 使用 Docker Compose 启动 `wordpress:latest` 和 `mariadb:11`，用 `wordpress:cli` 完成安装并创建应用程序密码，然后运行 `wordpress.e2e.ts`。该测试用内存中的 EdgeEver 上下文（一篇 Markdown 笔记和一张 PNG 资源）驱动发布核心，分别在普通固定链接和美化固定链接下各运行一次，结束后删除所有容器和数据。设置 `KEEP_WORDPRESS=1` 可保留站点，设置 `WP_PORT` 可更换端口。

### 发布新版本

EdgeEver 从默认分支的 `manifest.json` 和对应的 GitHub Release 安装 GitHub 插件。

1. 同时修改 `package.json` 和 `manifest.json` 中的 `version`（两者不一致时构建会失败），并提交到默认分支。
2. 推送 `X.Y.Z` 或 `vX.Y.Z` 标签。`.github/workflows/release.yml` 会运行测试、构建，并把 `manifest.json` 和 `main.js` 上传到 Release。
3. Release 中的 `manifest.json` 必须与默认分支上的完全一致，打标签后不要再修改 manifest。

内置的第三方代码：[marked](https://github.com/markedjs/marked)（MIT），其许可声明保留在 `main.js` 开头。

### 许可证

MIT，见 [LICENSE](LICENSE)。
