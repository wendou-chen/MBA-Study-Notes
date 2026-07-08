# Obsidian Self-Developed Plugins

[中文](README.md) | English

This repository is the public version of my Obsidian Vault. It only publishes the Obsidian plugins I maintain myself and a minimal public Obsidian configuration.

It is not the complete study-notes repository and does not contain my private exam-preparation notes.

## Included

### Codexidian

Path: `.obsidian/plugins/codexidian/`

An Obsidian sidebar plugin for working with Codex. It supports multi-session chat, context injection, tool-call rendering, plan cards, session persistence, and basic Vault MCP capabilities.

### Kaoyan Countdown

Path: `.obsidian/plugins/kaoyan-countdown/`

A countdown and focus plugin for exam preparation. It includes exam countdown, daily-plan views, phase progress, Pomodoro mode, scientific focus sessions, and simple focus statistics.

### Bookmarked PDF Export

Path: `.obsidian/plugins/outline-markdown-export/`

Exports Obsidian Markdown notes to PDFs with native bookmarks. The plugin builds a PDF outline from Markdown headings so chapters can be navigated directly in PDF readers.

## Not Included

This public repository intentionally excludes:

- personal notes, daily plans, mistakes, reviews, and real study records
- AI agent prompts, private automation, caches, session logs, and runtime data
- third-party plugins that are installed locally but not maintained by me
- plugin `node_modules/`, nested `.git/` folders, generated files, and exported artifacts

Examples of paths that must not enter the public repository:

- `Daily Notes/`
- `考研数学/`, `考研英语/`, `考研计划/`
- `.agent/`, `.agents/`, `.claude/`, `.codex/`, `.learning/`
- `.obsidian/plugins/claudian/`
- `.obsidian/plugins/obsidian-local-rest-api/`

## Repository Layout

```text
.obsidian/
  app.json
  appearance.json
  community-plugins.json
  core-plugins.json
  daily-notes.json
  templates.json
  plugins/
    codexidian/
    kaoyan-countdown/
    outline-markdown-export/
LICENSE
OPEN_SOURCE_PRIVATE_LAYOUT.md
README.md
README.en.md
```

## Development

Each plugin keeps its own `package.json` and build scripts. Enter a plugin directory before installing dependencies or building:

```bash
cd .obsidian/plugins/codexidian
npm install
npm run build
```

Use the same pattern for `kaoyan-countdown` and `outline-markdown-export`:

```bash
cd .obsidian/plugins/kaoyan-countdown
npm install
npm run build
```

```bash
cd .obsidian/plugins/outline-markdown-export
npm install
npm run build
```

## Public Boundary

This repository is only the public surface for reusable plugins and configuration. The full private Vault, study notes, and daily planning system remain in the private repository.

See [OPEN_SOURCE_PRIVATE_LAYOUT.md](OPEN_SOURCE_PRIVATE_LAYOUT.md) for more details.

## License

See [LICENSE](LICENSE).
