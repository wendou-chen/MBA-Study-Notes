# 考研备考 Obsidian Vault

基于 Obsidian 的考研备考知识库模板，包含两个自研插件（源码开放）、社区自动化脚本和学习笔记模板。

## 仓库内容

### 自研插件（含完整源码）

**Kaoyan Countdown** — 考研倒计时 + 每日任务 + 专注计时

- 距考试天数倒计时
- 从每日计划文件解析任务，支持勾选回写
- 周视图完成率总览、阶段规划视图
- 番茄钟 / 科学专注 (90min) / 正计时模式
- 源码：`.obsidian/plugins/kaoyan-countdown/src/`

**Codexidian** — Obsidian 侧边栏 Codex 聊天面板

- 通过 `codex app-server` 在 Obsidian 内直接与 Codex 对话
- 支持多轮会话、文件上下文、选区发送
- 源码：`.obsidian/plugins/codexidian/src/`

### 社区脚本（`community/`）

| 脚本 | 说明 |
|------|------|
| `scripts/auto_daily_plan_min.py` | 基于配置文件生成每日学习计划 |
| `scripts/paper_digest_min.py` | 抓取 arXiv 论文生成 Obsidian 格式摘要 |
| `templates/math-problem-board.md` | 数学解题板模板 |
| `config/plan_config.example.json` | 计划生成配置示例 |

### 学习笔记模板

- `考研数学/解题板.md` — 数学解题板（粘贴题目截图，配合 AI 使用）
- `考研数学/固定解法速查表.md` — 高频题型解法速查
- `考研数学/概念辨析与公式推导合集.md` — 易混概念辨析
- `考研英语/写作素材库.md` — 英语写作模板与句型
### 其他

- `start_obsidian.py` — MCP 服务器启动脚本（供 AI 工具读写 Vault）
- `论文日报/` — arXiv 论文中文摘要示例
- `Excalidraw/` — 知识图谱可视化
- `copilot/copilot-custom-prompts/` — Obsidian Copilot 自定义提示词模板

## 目录结构

```
├── .obsidian/plugins/
│   ├── kaoyan-countdown/   # 考研倒计时插件（含源码）
│   ├── codexidian/         # Codex 聊天插件（含源码）
│   ├── claudian/           # Claude 聊天插件
│   ├── error-collector/    # 错题收集插件
│   └── ...                 # 其他社区插件
├── community/              # 社区公开脚本与模板
├── 考研数学/               # 数学笔记模板
├── 考研英语/               # 英语笔记模板
├── 论文日报/               # 论文摘要示例
├── Excalidraw/             # 可视化图谱
├── start_obsidian.py       # MCP 服务器启动
└── .mcp.json               # MCP 配置
```

## 快速开始

1. 克隆仓库并用 [Obsidian](https://obsidian.md/) 打开：

```bash
git clone https://github.com/wendou-chen/MBA-Study-Notes.git
```

2. 在 Obsidian 设置中启用需要的插件（Kaoyan Countdown、Codexidian 等）

3. （可选）运行社区脚本：

```bash
python community/scripts/auto_daily_plan_min.py
python community/scripts/paper_digest_min.py --max-results 5
```

## 关于私有内容

本仓库为公开版本，不包含以下私有内容：

- Agent 提示词与编排策略
- 自动化技能定义（Skills）
- 个人错题记录与学习计划
- 高级自动化脚本

详见 `OPEN_SOURCE_PRIVATE_LAYOUT.md`。

## 技术栈

- [Obsidian](https://obsidian.md/) — Markdown 知识库
- [MCP](https://modelcontextprotocol.io/) — AI 工具与 Vault 的桥接协议
- TypeScript + esbuild — 插件开发
- Python — 自动化脚本

## 许可证

MIT
