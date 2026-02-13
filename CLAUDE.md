# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture
- **Type**: Obsidian Vault for Postgraduate Entrance Exam (考研) study notes.
- **Integration**: Uses Model Context Protocol (MCP) to allow AI interaction with notes via `start_obsidian.py`.
- **Structure**:
  - `考研数学/`: Main study notes, categorized by subject and type (e.g., `错题`, `习题集`).
  - `Excalidraw/`: Visual knowledge graphs and diagrams.
  - `.claude/`: Custom skills and configuration for Claude Code.

## Automation & Skills
- **MCP Server**: `python start_obsidian.py` launches the Obsidian MCP server (requires `OBSIDIAN_API_KEY` in `.env`).
- **Image Organization**: Use the `study-notes-image-organization` skill to move pasted images into local `images/` directories and update links.
- **Learning Patterns**: Use `/learn` to extract study patterns, common mistakes, or exam techniques into reusable skills.

## Conventions
- **Markdown**: Standard Obsidian-flavored Markdown. Use `[[Link]]` for internal links and `![[Image]]` for embeddings.
- **Math**: Use LaTeX for formulas (e.g., `$x^2$`, `$$ \int f(x) dx $$`).
- **File Management**:
  - Do not upload large media files (PDF, MP4, etc.).
  - Keep `.env` and sensitive plugin data (e.g., `copilot/data.json`) out of version control.
