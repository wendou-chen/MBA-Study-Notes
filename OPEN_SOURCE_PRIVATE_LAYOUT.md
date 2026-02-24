---
tags:
  - open-source
  - repository
  - governance
---

# 开源版 / 私有版目录方案

## 目标

- 开源版：对外可复用、可运行、可学习。
- 私有版：保留高价值 Agent 提示词、编排策略、个人工作流与个人数据。

## 开源版（建议保留）

```text
README.md
.gitignore
.mcp.json
start_obsidian.py
community/
  README.md
  config/
    plan_config.example.json
  scripts/
    auto_daily_plan_min.py
    paper_digest_min.py
  templates/
    math-problem-board.md
.obsidian/plugins/kaoyan-countdown/      (可选：如果你希望开源插件本体)
.obsidian/plugins/codexidian/            (可选：如果你希望开源插件本体)
```

## 私有版（建议保留本地/私有仓库）

```text
.agent/          # Agent 提示词与工作流细节
.claude/         # Claude 侧私有技能与会话
.codex/          # Codex 侧私有技能与会话
.scripts/        # 原始高价值自动化脚本（私有版）
CLAUDE.md        # 私有策略文档
.env
.ccb/
.codexidian/
copilot/copilot-conversations/
考研数学/错题/
抖音素材/
```

## 当前仓库的落地策略

1. 使用 `.gitignore` 屏蔽私有资产：`.agent/ .claude/ .codex/ .scripts/ CLAUDE.md`。
2. 保留 `community/` 作为社区最小可用版本（Auto Daily Plan + 论文日报 + 解题板模板）。
3. 私有高级能力在你本地继续迭代，不进入公开仓库历史。

## 提交前检查

```bash
git status --short
git check-ignore -v .agent .claude .codex .scripts CLAUDE.md
git ls-files | rg "^(\\.agent|\\.claude|\\.codex|\\.scripts|CLAUDE\\.md)"
```

如果最后一条命令有输出，说明仍有私有文件在跟踪列表中，需要继续 `git rm --cached <path>`。

