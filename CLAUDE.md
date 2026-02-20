# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture
- **Type**: Obsidian Vault for Postgraduate Entrance Exam (考研) study notes & tactical planning.
- **Core System**:
  - **Platform**: Obsidian (Markdown-based knowledge base).
  - **Integration**: Model Context Protocol (MCP) via `start_obsidian.py` to allow AI interaction with note content.
- **Directory Structure**:
  - `考研数学/`, `考研英语/`, `专业课/`: Subject-specific study notes (definitions, theorems, mistakes).
  - `考研计划/`: Daily/Weekly plans and reviews (managed by Planner Agent).
  - `.claude/agents/`: Role definitions for specialized agents (Master, Planner, Math, Major, English, Politics, Layout).
  - `Excalidraw/`: Visual knowledge graphs.

## User Context (Profile)
- **Candidate**: 陈文斗 (Wendou Chen), 2027 届通信工程本科 (湖北文理学院, GPA 3.8/4.0).
- **Target**: 华东五校 / 中坚九校 (通信/电子方向).
- **Current Status**:
  - **Math**: 数学一. 曾获**CMC 湖北省一等奖** (冲刺国赛). 正在进行**高数深度一轮** (重点攻克: 微分方程, 无穷级数, 多元函数积分). 线代/概率论待启动.
  - **Major**: 信号与系统. 拥有 **SignalViz-Pro** 仿真项目经验, 获大唐杯国二, 具备扎实 Python/MATLAB 信号处理基础.
  - **English**: CET-6 501 分.
  - **Awards**: MCM Meritorious Winner, 蓝桥杯国二, AIC 机器人国一.

## Commands
- **Start MCP Server**:
  ```bash
  python start_obsidian.py
  ```
  *Required to enable read/write access to Obsidian vault via MCP.*

- **Note Synchronization**:
  ```bash
  git add .
  git commit -m "docs: update study notes [date]"
  git push
  ```

- **Agent Interaction (Conceptual)**:
  - `/plan`: Invoke **Planner Agent** to generate daily schedules or review progress.
  - `/math`: Invoke **Math Agent** for theorem explanation or problem solving.
  - `/learn`: Extract recurring mistake patterns into reusable skills.

## Conventions
- **Markdown & Obsidian**:
  - Use `[[WikiLinks]]` for internal connections.
  - Use `![[Image.png]]` for embeddings.
  - Use Callouts (`> [!tip]`) for key takeaways.
  - **Frontmatter**: All plan/review notes must include YAML frontmatter (date, tags, phase).
- **Mathematics**:
  - Use LaTeX for all formulas: `$E = mc^2$` (inline) or `$$ \int_0^\infty f(x) dx $$` (block).
- **Code/Projects**:
  - **SignalViz**: Python/Streamlit project used for *visualization only* during review. Do not develop new features unless essential for understanding a concept.
- **Style**:
  - **Planner**: Cold, precise, data-driven. Focus on completion rates and ROI.
  - **Notes**: Structured, rigorous, using "Definition-Theorem-Proof-Example" format.

## Development & Maintenance
- **Agents**: Agent definitions are in `.claude/agents/*.md`. When modifying an agent's behavior, update the corresponding markdown file and ensure the YAML header is preserved.
- **Images**: Do not manually manage images. Use the `study-notes-image-organization` skill to organize pasted images into local asset folders.

## Codex CLI Usage (Windows)

When delegating tasks to Codex on this Windows machine:

### ✅ Correct: `codex exec` (no TTY needed)
```powershell
# Short prompts
codex exec "task description here"

# Long prompts (recommended - avoids quoting issues)
$plan = Get-Content '.agent\codex-current-plan.md' -Raw
codex exec $plan
```

### ❌ Wrong: TUI mode (requires TTY, fails in run_command)
```powershell
# These fail with "stdin is not a terminal":
codex -a never "prompt"
echo "prompt" | codex
```

### Standard Workflow
1. Write task to `.agent\codex-current-plan.md`
2. Run: `$plan = Get-Content '.agent\codex-current-plan.md' -Raw; codex exec $plan`
3. Poll with `command_status` until `Status: DONE`

