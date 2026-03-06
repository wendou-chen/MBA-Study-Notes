---
tags:
  - community
  - kaoyan
  - automation
---

# Community（可选扩展）

这个目录保留的是 **公开、安全、偏学习流程** 的扩展脚本与模板。

> [!info]
> `community/` 不是本仓库的主入口。主入口是根目录的插件、题板模板和计划示例。

## 当前保留内容

1. `scripts/auto_daily_plan_min.py`
   - 生成最小可用的每日计划。
   - 不依赖私有技能、会话记录或个人数据。

2. `scripts/paper_digest_min.py`
   - 抓取 arXiv 并生成 Obsidian Markdown 摘要。
   - 仅保留公开可复现的基础能力。

3. `templates/math-problem-board.md`
   - 社区版数学解题板模板。

## 设计边界

- 保留：学习相关、可公开复用、无个人敏感数据的流程。
- 不保留：抖音发布、私有技能编排、个人计划生成策略、会话日志。

## Quick Start

```bash
python community/scripts/auto_daily_plan_min.py
python community/scripts/paper_digest_min.py --max-results 5
```

