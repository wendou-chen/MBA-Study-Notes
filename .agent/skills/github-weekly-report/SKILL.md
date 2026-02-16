---
name: github-weekly-report
description: 每周自动抓取 GitHub 热门项目并生成中文摘要周刊，写入 Obsidian 笔记。适用于用户说"GitHub 周刊"、"周热榜"、"本周热门项目"、"weekly report"时触发。脚本覆盖全局热榜、AI/ML、信号处理/通信、Python 工具四个分类，调用 Claude API 生成中文摘要，输出为带 frontmatter 和 callout 的 Obsidian Markdown 文件到 `GitHub周刊/` 目录。
---

# GitHub 周热榜生成器

每周从 GitHub 抓取热门项目，调用 Claude API 生成中文摘要，输出为 Obsidian 友好的 Markdown 周刊。

## 使用方法

```bash
python .claude/skills/github-weekly-report/scripts/weekly_github.py
```

## 前置条件

- `.env` 中配置 `ANTHROPIC_API_KEY`（必需）和 `ANTHROPIC_BASE_URL`（可选）
- `.env` 中配置 `GITHUB_TOKEN`（推荐，否则匿名限速 10 次/分钟）
- 安装依赖：`pip install anthropic requests`

## 输出

- 文件路径：`GitHub周刊/{week_start}~{week_end}.md`
- 格式：YAML frontmatter + 分类表格 + AI 深度摘要 callout（全局热榜）
- 如本周文件已存在，则跳过

## 覆盖分类

| 分类 | 最低 Stars | 数量 | 深度摘要 |
|------|-----------|------|---------|
| 🔥 全局热榜 | 100 | 5 | ✅ |
| 🤖 AI / 机器学习 | 30 | 5 | ❌ |
| 📡 信号处理 / 通信 | 5 | 2 | ❌ |
| 🐍 Python 工具 | 50 | 3 | ❌ |
