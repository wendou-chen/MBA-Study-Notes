---
name: arxiv-daily-digest
description: 每日自动抓取 ArXiv 最新论文并生成中文摘要，写入 Obsidian 笔记。适用于用户说"论文日报"、"今日论文"、"抓论文"、"paper digest"时触发。脚本聚焦无线通信方向（UAV 轨迹优化、ISAC、RIS、语义通信），调用 Claude API 生成结构化中文摘要，输出为带 frontmatter 和 callout 的 Obsidian Markdown 文件到 `论文日报/` 目录。
---

# ArXiv 论文日报生成器

每日从 ArXiv 检索无线通信前沿论文，调用 Claude API 生成中文摘要，输出为 Obsidian 友好的 Markdown 笔记。

## 使用方法

```bash
python .claude/skills/arxiv-daily-digest/scripts/daily_paper.py
```

## 前置条件

- `.env` 中配置 `ANTHROPIC_API_KEY`（必需）和 `ANTHROPIC_BASE_URL`（可选）
- 安装依赖：`pip install anthropic arxiv`

## 输出

- 文件路径：`论文日报/{YYYY-MM-DD}.md`
- 格式：YAML frontmatter + 论文表格 + AI 摘要 callout
- 如当日文件已存在，则追加运行

## 检索方向

| 关键词 | 领域 |
|--------|------|
| UAV Trajectory Optimization | 无人机轨迹优化 |
| ISAC / Integrated Sensing and Communication | 通感一体化 |
| RIS / Reconfigurable Intelligent Surface | 智能超表面 |
| Semantic Communication | 语义通信 |
