<p align="right">
  <a href="./README.md">🇬🇧 English</a>
</p>

# Codexidian

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Obsidian%20Desktop-purple)

一个把 **Codex app-server** 原生嵌入 Obsidian 的聊天工作台，支持多标签会话、结构化运行状态展示，以及面向 Vault 的上下文工作流。

![Screenshot](image.png)

## 功能特性

### 核心聊天
- 💬 **多标签会话**：并行管理多个对话，适合长期项目和分支探索。
- 🔄 **流式输出 + 可中断**：回复实时流式渲染，`Esc` 可随时取消当前轮次。
- 🧵 **线程持久化**：重启后可复用 thread，失效时自动回退新线程。
- 🧾 **结构化渲染**：Thinking 区块和 Tool 卡片分开展示，过程更透明。

### 生产力与控制
- 🧠 **Model / Effort 控件**：工具栏和 slash 命令都可快速切换。
- 🧩 **Skill 动态选择器**：自动扫描 `.codex/skills/*/SKILL.md`，按轮注入 `[Skill: ...]`。
- 🛡️ **Mode 审批模式**：`Safe` / `Prompt` / `Yolo` 三种审批行为。
- ⚡ **Slash 命令系统**：`/new`、`/clear`、`/model`、`/effort`、`/history`、`/tabs`、`/help`。

### 上下文与附件
- 📎 **文件上下文（@mention）**：将笔记文件内容作为上下文附加到请求。
- 🖼️ **图片附件**：支持粘贴、拖拽、文件选择三种方式。
- 📝 **当前笔记 / 选区注入**：可选地把编辑器上下文加入提示词。
- 🔌 **MCP 集成（可选）**：通过 Obsidian API 提供笔记读写/检索能力。

### 审查、计划与编辑
- 📊 **Status Panel**：展示当前轮次状态和最近操作时间线。
- 🔍 **Review Pane**：显示上轮推断的文件变更，并可排队评论到下一轮。
- 🗺️ **Plan Mode 工作流**：把计划内容解析为可操作卡片（审批/反馈/逐步执行）。
- ✏️ **内联编辑（用户消息）**：直接编辑历史用户消息并从该点重发。
- 🧪 **Apply to Note**：将 AI 代码块一键应用到笔记（替换选区或追加）。
- 🌿 **Rewind / Fork**：从任意用户消息回退或分叉新会话。

### 会话管理与安全
- 🗂️ **Session Modal**：支持搜索、过滤、置顶、归档、分叉、删除。
- ✅ **Inline Approval + Always Allow**：聊天中审批，并可固化允许规则。
- 🔐 **安全控制**：路径黑名单、写入确认、最大笔记大小限制。
- 🌐 **i18n 国际化**：中英双语界面。

## 前置要求

- Obsidian Desktop `>= 1.4.5`
- 已安装 Codex CLI，且命令可在 PATH 中找到（`codex` / `codex.cmd`）
- 已完成 Codex CLI 登录/认证（推荐先在终端执行一次 `codex login`）
- Node.js `>= 18`（仅开发/构建需要）

## 安装方式

当前以手动安装为主：

1. 准备插件文件：`manifest.json`、`main.js`、`styles.css`
2. 创建目录：
   - `<你的 Vault>/.obsidian/plugins/codexidian/`
3. 将文件复制到该目录
4. 打开 Obsidian -> `Settings` -> `Community plugins`
5. 启用 **Codexidian**

## 配置说明

路径：`Settings -> Codexidian`

### 通用
- `Language`：界面语言（`en` / `zh`）
- `Codex command`：启动 app-server 的命令
- `Working directory`：每轮请求的工作目录

### 每轮控制
- `Model`：模型选择（或默认）
- `Thinking effort`：`low` / `medium` / `high` / `xhigh`
- `Skill`：从 `.codex/skills` 动态加载的默认 skill
- `Mode`：审批模式（`Safe` / `Prompt` / `Yolo`）

### 审批与运行
- `Approval policy`：app-server 层审批策略
- `Sandbox mode`：沙箱策略
- `Auto-approve app-server requests`：旧兼容自动审批开关
- `Persist thread across restarts`
- `Saved thread`：清除保存的线程 ID

### UI 与上下文
- `Max tabs`（1-5）
- `Context injection`
- `Selection polling`

### MCP
- `Enable MCP vault tools`
- `MCP endpoint`（可选）
- `MCP API key`（可选，仅用于连接你自己的 MCP/Obsidian 接口，不是 Codex 模型密钥）
- `Auto MCP context notes`（自动附加笔记数量）

### 安全
- `Blocked paths`（每行一个规则）
- `Require approval for write`
- `Max note size (KB)`
- `Allow rules`：查看/删除/清空 Always-Allow 规则

## 使用指南

### 1. 打开面板
- 点击左侧 Ribbon 的机器人图标，或执行命令 `Open Codexidian`。

### 2. 发送消息
- 在输入框输入内容，按 `Enter` 或点击 **Send**。
- 回复会在当前标签页流式显示。

### 3. 使用 slash 命令
- 输入 `/` 即可弹出命令菜单。
- 用方向键选择，`Enter` 执行。

### 4. 切换 model / effort / skill / mode
- 通过底部工具栏快速切换：
  - `[Model] [Effort] [Skill] [📁] [Mode]`

### 5. 添加附件
- 文件：通过上下文文件选择器附加。
- 图片：支持粘贴、拖拽、点击 `📁` 选择。

### 6. 管理会话
- 点击 **History** 打开 Session Modal。
- 可搜索、过滤、置顶、归档、分叉、打开、删除。

### 7. Rewind / Fork
- 在用户消息右侧可用：
  - `✏` 编辑
  - `↩` 回退
  - `⑂` 分叉

### 8. 使用 Review Pane
- Tool 执行后可查看变更列表。
- 添加评论后会自动拼接到下一次请求中。

### 9. 使用 Plan Mode
- 检测到计划内容后，会显示 Plan 卡片。
- 可直接执行：**Approve All**、**Give Feedback**、**Execute Next**。

## 键盘快捷键

- `Enter`：发送消息
- `Shift+Enter`：输入换行
- `Ctrl+Enter` / `Cmd+Enter`：发送消息
- `Esc`：取消当前流式输出
- Slash 菜单：
  - `ArrowUp` / `ArrowDown`：上下选择
  - `Enter`：执行命令
  - `Esc`：关闭菜单

## 与 Claudian 的简要对比

- **Codexidian**：后端引擎是 **Codex app-server**。
- **Claudian**：核心围绕 **Claude 工作流**。
- 两者都追求原生 Obsidian 聊天体验；Codexidian 更强调 Codex 的 tool/turn 流程、计划审查闭环，以及 Vault 场景下的 MCP 能力。

## 开发说明

```bash
cd .obsidian/plugins/codexidian
npm install
npm run build
```

开发监听：

```bash
npm run dev
```

## License

MIT

## Credits

- Obsidian API 与插件生态
- Codex app-server 运行时
- 同 Vault 下 Claudian 的交互体验参考
