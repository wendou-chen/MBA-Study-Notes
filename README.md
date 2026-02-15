# 考研笔记 Vault

备考通信/电子方向研究生的 Obsidian 知识库，包含学科笔记、错题集、复习计划与 AI 辅助工具。

## 目录结构

```
├── 考研数学/        # 高数、线代、概率论笔记与错题
│   ├── 错题/       # 按章节分类的错题分析
│   └── 习题集/     # 练习题与解答
├── 考研计划/        # 每日/每周复习计划与回顾
├── 论文日报/        # ArXiv 前沿论文中文摘要（自动生成）
├── Excalidraw/     # 知识图谱与可视化
├── .claude/        # AI Agent 定义与技能配置
│   └── agents/     # Master、Math、English、Major 等角色
├── daily_paper.py  # 论文日报自动化脚本
└── start_obsidian.py # MCP 服务器启动脚本
```

## 功能

- **Obsidian 知识管理**：双向链接、标签体系、Dataview 查询
- **AI Agent 协作**：通过 Claude Code 提供数学答疑、计划生成、笔记整理等能力
- **MCP 集成**：`start_obsidian.py` 启动 Model Context Protocol 服务器，让 AI 直接读写笔记
- **论文日报**：`daily_paper.py` 每日自动抓取 ArXiv 最新论文（UAV 轨迹优化、ISAC、RIS、语义通信），调用 Claude 生成中文摘要，输出为 Obsidian 友好的 Markdown

## 快速开始

1. 用 [Obsidian](https://obsidian.md/) 打开本文件夹作为 Vault
2. 配置 `.env` 文件：
   ```
   OBSIDIAN_API_KEY=你的obsidian-api-key
   ANTHROPIC_API_KEY=你的claude-api-key
   ANTHROPIC_BASE_URL=你的api代理地址
   ```
3. 运行论文日报：
   ```bash
   python daily_paper.py
   ```
