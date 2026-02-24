# CLAUDE.md

本文件为 Claude Code / Codex CLI 在此仓库中工作时提供上下文和规范。

## 项目概述

- **类型**：Obsidian Vault — 2027 考研备考知识库 + 战术规划系统
- **平台**：Obsidian（Markdown 知识库）+ 多 AI 插件集成
- **仓库地址**：GitHub 私有仓库，通过 obsidian-git 插件同步

## 目录结构

```
考研数学/          # 数学一笔记（定义、定理、错题）
考研英语/          # 英语笔记（阅读、写作、词汇）
专业课/            # 信号与系统笔记
考研计划/          # 每日/每周计划与复盘（Planner Agent 管理）
Excalidraw/        # 可视化知识图谱
copilot/           # Copilot 插件会话记录
.codexidian/       # Codexidian 插件会话持久化（JSONL）
.claude/
  agents/          # 专业 Agent 角色定义（8 个）
  skills/          # Claude Code 技能（20+）
.agent/            # Codex CLI 计划文件和技能
.obsidian/
  plugins/
    claudian/      # Claude SDK 聊天插件（v1.3.65，成熟）
    codexidian/    # Codex app-server 聊天插件（开发中）
    copilot/       # Obsidian Copilot
    obsidian-git/  # Git 同步
    ...            # 其他工具插件
```

## 用户画像

- **考生**：陈文斗（Wendou Chen），2027 届通信工程本科（湖北文理学院，GPA 3.8/4.0）
- **目标院校**：SCUT（通信/电子方向）
- **当前进度**：
  - **数学**：数学一。CMC 湖北省一等奖。高数深度一轮中（重点：微分方程、无穷级数、多元函数积分）。线代/概率论待启动。
  - **专业课**：信号与系统。SignalViz-Pro 仿真项目经验，大唐杯国二，Python/MATLAB 信号处理基础扎实。
  - **英语**：CET-6 501 分。
  - **竞赛**：MCM Meritorious Winner、AIC 机器人国一。

## Agent 系统

`.claude/agents/` 下定义了 8 个专业 Agent：

| Agent | 职责 |
|-------|------|
| master | 总调度，任务分发 |
| planner | 每日/每周计划生成与复盘 |
| math | 数学定理讲解、解题 |
| major | 信号与系统专业课 |
| english | 英语学习 |
| politics | 政治复习 |
| layout | 排版与格式化 |
| social-media | 社交媒体内容（抖音等） |

## 技能系统

`.claude/skills/` 下有 20+ 技能，常用的包括：
- `auto-daily-plan` — 自动生成每日计划
- `math-problem-solver` — 数学解题
- `flashcard-generator` — 闪卡生成
- `error-template-scaffold` — 错题模板
- `douyin-publisher` — 抖音内容发布
- `weekly-review` — 周复盘
- `sync-skills` — 技能同步

## 常用命令

```bash
# MCP 服务器（AI 读写 Vault 内容）
python start_obsidian.py

# 笔记同步
git add . && git commit -m "docs: update study notes" && git push

# Codexidian 插件构建
cd .obsidian/plugins/codexidian && npm run build
```

### Agent 交互

- `/plan` — 调用 Planner Agent 生成日程或复盘
- `/math` — 调用 Math Agent 讲解定理或解题
- `/learn` — 提取错题规律为可复用技能

## 写作规范

### Markdown & Obsidian
- 内部链接用 `[[WikiLinks]]`
- 嵌入用 `![[Image.png]]`
- 重点用 Callout：`> [!tip]`、`> [!warning]`
- 计划/复盘笔记必须包含 YAML frontmatter（date、tags、phase）

### 数学公式
- 行内：`$E = mc^2$`
- 块级：`$$ \int_0^\infty f(x)\,dx $$`
- 所有公式必须用 LaTeX

### 笔记风格
- **计划类**：冷静、精确、数据驱动，关注完成率和 ROI
- **知识类**：严谨结构化，遵循「定义-定理-证明-例题」格式

## 开发维护

- **Agent 定义**：修改 `.claude/agents/*.md`，保留 YAML header
- **图片管理**：不手动管理，使用 `study-notes-image-organization` 技能自动整理到本地 asset 文件夹
- **插件开发**：Codexidian 源码在 `.obsidian/plugins/codexidian/src/`，所有文件 I/O 走 Obsidian `app.vault.adapter`，不用 Node fs

### 注意事项
- TUI 模式需要 TTY，在 `run_command` 中会失败
- 使用 `codex exec` 替代交互模式
- CCB 模式下通过 `ask codex` 委托任务
