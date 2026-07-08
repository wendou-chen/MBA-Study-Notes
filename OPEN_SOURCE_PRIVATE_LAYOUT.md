---
tags:
  - open-source
  - repository
  - governance
---

# Public / Private Boundary

## Public Repository

The public repository only contains self-developed Obsidian plugins and minimal public Obsidian configuration.

Public plugin allowlist:

- `.obsidian/plugins/codexidian/`
- `.obsidian/plugins/kaoyan-countdown/`
- `.obsidian/plugins/outline-markdown-export/`

Public configuration allowlist:

- `.obsidian/app.json`
- `.obsidian/appearance.json`
- `.obsidian/community-plugins.json`
- `.obsidian/core-plugins.json`
- `.obsidian/daily-notes.json`
- `.obsidian/templates.json`
- `README.md`
- `README.en.md`
- `LICENSE`
- `.gitignore`

## Private Repository

The private repository remains the only place for personal study material and agent workflows.

Private-only content includes:

- `Daily Notes/`
- `考研数学/`, `考研英语/`, `考研计划/`
- `.agent/`, `.agents/`, `.claude/`, `.codex/`, `.learning/`, `.reasonix/`
- third-party plugins that are installed locally but not maintained here
- caches, session logs, generated PDFs, screenshots, and local runtime data
- API keys, local machine paths, and private automation scripts

## Publishing Rule

Do not push `main` to the public remote.

Publish only from the sanitized public branch:

```bash
git push public public-template:main
```

If the public branch needs to replace a previously leaked or incorrect tree, use `--force-with-lease` and verify the final tree before changing repository visibility.

## Pre-Publish Checks

```bash
git ls-tree -r --name-only public-template
git ls-tree -r --name-only public-template | rg "^(\.agent|\.agents|\.claude|\.codex|\.learning|Daily Notes|考研数学|考研英语|考研计划|Templates|community|copilot|Excalidraw)"
git ls-tree -r public-template | rg "^160000 "
```
