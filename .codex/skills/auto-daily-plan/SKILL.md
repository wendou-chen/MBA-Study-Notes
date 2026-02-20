---
name: auto-daily-plan
description: 自动生成考研每日计划。定时触发（cron 06:00）或手动运行 .scripts/auto_daily_plan.py。读取昨日完成率、当前阶段、待复习错题，调用 Claude API 生成兼容 kaoyan-countdown 插件的计划文件。
---

# 自动每日计划生成器

## 触发方式

- 定时触发（推荐）：cron 每天 06:00
- 手动触发：`python3 .scripts/auto_daily_plan.py`

cron 配置示例（仅说明，不在脚本中自动执行）：

```bash
# crontab -e
# 0 6 * * * cd /mnt/d/a考研/Obsidian\ Vault && python3 .scripts/auto_daily_plan.py >> .scripts/auto_plan.log 2>&1
```

## 数据流

1. 幂等检查：若 `考研计划/YYYY-MM-DD 周X.md` 已存在则退出。
2. 读取昨日计划：统计 `- [x]` 与 `- [ ]` 计算完成率，并提取未完成任务。
3. 读取配置：`.scripts/plan_config.json`，按日期匹配当前阶段和资源分配。
4. 扫描错题图片：`考研数学/错题/*/images/`，从文件名提取日期并按间隔计算今日待复习数（按章节）。
5. 生成提示词：注入日期、阶段、完成率、错题复习量、本月里程碑与严格格式约束。
6. 调用 Claude：使用 `anthropic` SDK（需 `ANTHROPIC_API_KEY`）。
7. 输出文件：写入 `考研计划/YYYY-MM-DD 周X.md`。

## 配置与依赖

- 配置文件：`.scripts/plan_config.json`
- 脚本文件：`.scripts/auto_daily_plan.py`
- Python 依赖：`pip install anthropic`
- 环境变量：`ANTHROPIC_API_KEY`

## 输出格式规范

输出必须兼容 `kaoyan-countdown` 插件解析规则，格式规范以 `kaoyan-daily-plan` skill 为准（参见 `.agent/skills/kaoyan-daily-plan/SKILL.md`）。

关键约束：

- 必须包含 frontmatter：`date/weekday/phase/type/status/tags`
- 任务行必须使用三段式：`- [ ] 时间 | 科目 | 描述`
- 必须包含战略重心 callout、晚间复盘表、上一日/下一日 wikilink
