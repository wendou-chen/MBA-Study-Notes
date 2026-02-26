<p align="right">
  <a href="./README_CN.md">🇨🇳 中文文档</a>
</p>

# Codexidian

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Obsidian%20Desktop-purple)

A native Obsidian chat workspace powered by **Codex app-server**, with multi-tab sessions, rich tool/plan visualization, and vault-aware workflows.

![Screenshot](image.png)

## Features

### Core Chat
- 💬 **Multi-tab chat workspace**: run and organize multiple conversations in parallel.
- 🔄 **Streaming + cancel**: stream assistant output in real time and stop with `Esc`.
- 🧵 **Thread persistence**: resume thread IDs across restarts with safe fallback to new threads.
- 🧾 **Structured rendering**: dedicated Thinking blocks and Tool cards for runtime transparency.

### Productivity & Control
- 🧠 **Model / Effort controls**: switch model and thinking effort from toolbar or slash commands.
- 🧩 **Dynamic Skill selector**: auto-load skills from `.codex/skills/*/SKILL.md` and inject `[Skill: ...]` per turn.
- 🛡️ **Approval Mode selector**: `Safe` / `Prompt` / `Yolo` for request approval behavior.
- ⚡ **Slash command menu**: `/new`, `/clear`, `/model`, `/effort`, `/history`, `/tabs`, `/help`.

### Context & Attachments
- 📎 **File context (@mention)**: attach note files as explicit context.
- 🖼️ **Image attachments**: paste, drag-and-drop, or pick images from file dialog.
- 📝 **Current note + selection context**: optional prompt augmentation from editor state.
- 🔌 **MCP integration**: optional vault tools (read/write/search/list) via Obsidian APIs.

### Review, Planning, and Editing
- 📊 **Status Panel**: live turn state and recent operation timeline.
- 🔍 **Review Pane**: show inferred diffs from tool activity and queue review comments for the next turn.
- 🗺️ **Plan Mode workflow**: parse plan-like outputs into actionable cards (approve/feedback/execute next).
- ✏️ **Inline Edit (user messages)**: edit a past user message, truncate, and resend from that point.
- 🧪 **Apply to Note**: apply assistant code blocks to notes (replace selection or append).
- 🌿 **Rewind / Fork**: branch conversations from any user message.

### Session Management & Safety
- 🗂️ **Session Modal**: search, filter, pin, archive, fork, open, and delete conversations.
- ✅ **Inline Approval + Always Allow**: approve/deny in transcript and create persistent allow rules.
- 🔐 **Security controls**: blocked path patterns, write approval gate, and max note size limits.
- 🌐 **i18n**: English and Chinese UI.

## Prerequisites

- Obsidian Desktop `>= 1.4.5`
- Codex CLI installed and available in PATH (`codex` / `codex.cmd`)
- Node.js `>= 18` (for building from source)

## Installation

Codexidian is currently intended for manual installation.

1. Build (or obtain) plugin files: `manifest.json`, `main.js`, `styles.css`.
2. Create folder:
   - `<YourVault>/.obsidian/plugins/codexidian/`
3. Copy plugin files into that folder.
4. Open Obsidian → `Settings` → `Community plugins`.
5. Enable **Codexidian**.

## Configuration

All settings are available in `Settings -> Codexidian`.

### General
- `Language`: `en` / `zh`
- `Codex command`: CLI executable used to start app-server
- `Working directory`: root cwd for Codex turns

### Turn Controls
- `Model`: model override (or default)
- `Thinking effort`: `low` / `medium` / `high` / `xhigh`
- `Skill`: dynamic default skill from `.codex/skills`
- `Mode`: approval behavior (`Safe`, `Prompt`, `Yolo`)

### Approval & Runtime
- `Approval policy`: app-server approval policy (`on-request`, `never`, ...)
- `Sandbox mode`: `workspace-write`, `read-only`, `danger-full-access`
- `Auto-approve app-server requests`: legacy auto-approval toggle
- `Persist thread across restarts`
- `Saved thread`: clear persisted thread ID

### UI & Context
- `Max tabs` (1-5)
- `Context injection`
- `Selection polling`

### MCP
- `Enable MCP vault tools`
- `MCP endpoint` (optional)
- `MCP API key` (optional)
- `Auto MCP context notes` limit

### Security
- `Blocked paths` (one pattern per line)
- `Require approval for write`
- `Max note size (KB)`
- `Allow rules`: view/remove/clear persistent Always-Allow rules

## Usage

### 1. Open the panel
- Use ribbon icon **bot** or command: `Open Codexidian`.

### 2. Send a message
- Type in input box and press `Enter` (or click **Send**).
- Response streams into the active tab.

### 3. Use slash commands
- Type `/` in input box and select from menu.
- Navigate with arrow keys and `Enter`.

### 4. Switch model / effort / skill / mode
- Use toolbar controls:
  - `[Model] [Effort] [Skill] [📁] [Mode]`

### 5. Attach context
- Attach files through file mention context.
- Attach images by paste, drag-drop, or `📁` picker.

### 6. Manage sessions
- Click **History** to open Session Modal.
- Search, filter, pin/archive, fork, open, or delete conversations.

### 7. Rewind / Fork
- On user messages, use action buttons:
  - `✏` edit
  - `↩` rewind
  - `⑂` fork

### 8. Use Review Pane
- After tool activity, review inferred file changes.
- Add scoped comments; queued comments are appended to the next turn prompt.

### 9. Use Plan Mode
- When a plan is detected, interact via Plan card:
  - **Approve All**
  - **Give Feedback**
  - **Execute Next**

## Keyboard Shortcuts

- `Enter`: send message
- `Shift+Enter`: newline in input
- `Ctrl+Enter` / `Cmd+Enter`: send message
- `Esc`: cancel current streaming turn
- Slash menu:
  - `ArrowUp` / `ArrowDown`: navigate
  - `Enter`: execute selected command
  - `Esc`: close menu

## Comparison with Claudian

- **Codexidian** uses **Codex app-server** as the backend engine.
- **Claudian** is designed around **Claude-centric** workflows.
- Both target native Obsidian chat UX, but Codexidian focuses on Codex turn/tool integration, plan/review workflows, and vault-oriented MCP operations.

## Development

```bash
cd .obsidian/plugins/codexidian
npm install
npm run build
```

Dev watch:

```bash
npm run dev
```

## License

MIT

## Credits

- Obsidian API and plugin ecosystem
- Codex app-server runtime model
- Claudian, as a UX reference in this vault environment
