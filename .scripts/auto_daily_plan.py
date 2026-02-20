#!/usr/bin/env python3
"""自动每日计划生成器 - 每天 06:00 由 cron 触发"""

# crontab -e
# 0 6 * * * cd /mnt/d/a考研/Obsidian\ Vault && python3 .scripts/auto_daily_plan.py >> .scripts/auto_plan.log 2>&1

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

# 从项目根目录 .env 加载环境变量（cron 执行时不会继承 shell 环境）
def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

_load_dotenv()
from typing import Any

CHECKBOX_DONE_RE = re.compile(r"^- \[[xX]\]\s*(.+)$", re.MULTILINE)
CHECKBOX_TODO_RE = re.compile(r"^- \[ \]\s*(.+)$", re.MULTILINE)
DATE_IN_FILENAME_RE = re.compile(r"(20\d{2})(\d{2})(\d{2})")
HIGH_SEVERITY_KEYWORDS = ("high", "高频", "重错", "难")


@dataclass
class YesterdayStats:
    completed: int
    pending: int
    completion_rate: float
    unfinished_tasks: list[str]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def find_plan_file_for_date(plan_dir: Path, target_date: date) -> Path | None:
    candidates = sorted(plan_dir.glob(f"{target_date.isoformat()} *.md"))
    if not candidates:
        return None
    return candidates[0]


def parse_yesterday_stats(yesterday_file: Path | None) -> YesterdayStats:
    if yesterday_file is None or not yesterday_file.exists():
        return YesterdayStats(
            completed=0,
            pending=0,
            completion_rate=0.0,
            unfinished_tasks=["无昨日计划文件或未记录任务"],
        )

    text = yesterday_file.read_text(encoding="utf-8")
    done_matches = CHECKBOX_DONE_RE.findall(text)
    todo_matches = CHECKBOX_TODO_RE.findall(text)
    completed = len(done_matches)
    pending = len(todo_matches)
    total = completed + pending
    rate = (completed / total) if total else 0.0

    unfinished = [line.strip() for line in todo_matches if line.strip()]
    if not unfinished:
        unfinished = ["无"]

    return YesterdayStats(
        completed=completed,
        pending=pending,
        completion_rate=rate,
        unfinished_tasks=unfinished,
    )


def parse_iso_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def determine_phase(today: date, phases: list[dict[str, Any]]) -> dict[str, Any]:
    if not phases:
        raise ValueError("配置缺少 phases")

    parsed = []
    for item in phases:
        start = parse_iso_date(item["start"])
        end = parse_iso_date(item["end"])
        parsed.append((start, end, item))

    for start, end, item in parsed:
        if start <= today <= end:
            return item

    parsed.sort(key=lambda x: x[0])
    if today < parsed[0][0]:
        return parsed[0][2]
    return parsed[-1][2]


def extract_date_from_filename(file_name: str) -> date | None:
    match = DATE_IN_FILENAME_RE.search(file_name)
    if not match:
        return None

    y, m, d = match.groups()
    try:
        return date(int(y), int(m), int(d))
    except ValueError:
        return None


def choose_interval_type(file_name: str) -> str:
    lowered = file_name.lower()
    if any(keyword in lowered for keyword in HIGH_SEVERITY_KEYWORDS):
        return "high"
    return "low"


def scan_due_error_reviews(
    error_root: Path,
    intervals_cfg: dict[str, list[int]],
    today: date,
) -> dict[str, int]:
    due_counts: dict[str, int] = {}
    low_intervals = set(intervals_cfg.get("low", []))
    high_intervals = set(intervals_cfg.get("high", []))

    if not error_root.exists():
        return due_counts

    for image_path in sorted(error_root.glob("*/images/*")):
        if not image_path.is_file():
            continue

        occurred_on = extract_date_from_filename(image_path.name)
        if occurred_on is None or occurred_on > today:
            continue

        delta_days = (today - occurred_on).days
        interval_type = choose_interval_type(image_path.name)
        intervals = high_intervals if interval_type == "high" else low_intervals
        if delta_days not in intervals:
            continue

        chapter = image_path.parent.parent.name
        due_counts[chapter] = due_counts.get(chapter, 0) + 1

    return dict(sorted(due_counts.items(), key=lambda item: item[0]))


def format_allocation(allocation: dict[str, float]) -> str:
    subject_names = {
        "math": "数学",
        "major": "专业课",
        "english": "英语",
        "competition": "竞赛",
        "politics": "政治",
        "review": "复盘",
    }
    parts = []
    for key, value in allocation.items():
        label = subject_names.get(key, key)
        parts.append(f"{label} {value:.0%}")
    return "，".join(parts)


def build_prompt(
    today: date,
    weekday_name: str,
    phase: dict[str, Any],
    allocation_desc: str,
    yesterday_stats: YesterdayStats,
    due_counts: dict[str, int],
    milestones: list[str],
) -> str:
    incomplete_text = "\n".join(
        f"- {task}" for task in yesterday_stats.unfinished_tasks[:20]
    )
    if not incomplete_text:
        incomplete_text = "- 无"

    if due_counts:
        review_text = "\n".join(f"- {chapter}: {count} 题" for chapter, count in due_counts.items())
    else:
        review_text = "- 今日无命中间隔的错题复习"

    milestone_text = "\n".join(f"- {item}" for item in milestones) if milestones else "- 本月无里程碑配置"

    yesterday_rate = f"{yesterday_stats.completion_rate:.1%}"

    return f"""你是考研计划助理，请生成今天的 Obsidian 每日计划。

今日信息：
- 日期：{today.isoformat()}
- 周几：{weekday_name}
- 当前阶段：Phase {phase['id']} · {phase['name']}
- 当前阶段资源分配：{allocation_desc}

昨日执行：
- 完成任务数：{yesterday_stats.completed}
- 未完成任务数：{yesterday_stats.pending}
- 完成率：{yesterday_rate}
- 未完成任务列表：
{incomplete_text}

今日待复习错题数（按章节）：
{review_text}

本月里程碑：
{milestone_text}

输出要求：
- 语言：中文
- 计划要结合昨日未完成任务延续安排
- 任务内容要可执行、具体，且匹配当前阶段分配
- 数学任务优先根据错题复习章节安排

严格遵循以下格式：
1. frontmatter: date/weekday/phase/type: daily-plan/status: pending/tags
2. 标题: # 📋 M.DD 周X · 主题
3. 战略重心 callout: > [!tip] 今日战略重心
4. 时间表: - [ ] HH:MM – HH:MM | 科目emoji | 描述
   科目emoji: 🔢 数学, 🔤 英语, 📡 专业课, 💻 项目, 📝 复盘
5. 晚间复盘表: | 指标 | 计划 | 实际 |
6. 关联区: 上一日/下一日 wikilink
"""


def load_ai_settings(repo_root: Path) -> dict[str, Any]:
    """从插件 data.json 读取 AI 设置，回退到 .env 环境变量"""
    data_json = repo_root / ".obsidian" / "plugins" / "kaoyan-countdown" / "data.json"
    if data_json.exists():
        try:
            data = json.loads(data_json.read_text(encoding="utf-8"))
            ai = data.get("ai", {})
            if ai.get("apiKey"):
                return {
                    "provider": ai.get("provider", "anthropic"),
                    "apiKey": ai["apiKey"],
                    "baseUrl": ai.get("baseUrl", ""),
                    "model": ai.get("model", ""),
                }
        except (json.JSONDecodeError, KeyError):
            pass

    return {
        "provider": "anthropic",
        "apiKey": os.getenv("ANTHROPIC_API_KEY", ""),
        "baseUrl": os.getenv("ANTHROPIC_BASE_URL", ""),
        "model": os.getenv("ANTHROPIC_MODEL", "claude-opus-4-6-20250616"),
    }


def _call_anthropic(prompt: str, settings: dict[str, Any]) -> str:
    api_key = settings["apiKey"]
    if not api_key:
        raise RuntimeError("缺少 API Key（Anthropic）")

    try:
        from anthropic import Anthropic
    except ImportError as exc:
        raise RuntimeError("未安装 anthropic SDK，请先执行: pip install anthropic") from exc

    client_kwargs: dict[str, Any] = {"api_key": api_key}
    base_url = settings.get("baseUrl")
    if base_url:
        client_kwargs["base_url"] = base_url

    client = Anthropic(**client_kwargs)
    model = settings.get("model") or "claude-opus-4-6-20250616"

    response = client.messages.create(
        model=model,
        max_tokens=16000,
        thinking={
            "type": "enabled",
            "budget_tokens": 8000,
        },
        messages=[{"role": "user", "content": prompt}],
    )

    parts = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    content = "".join(parts).strip()
    if not content:
        raise RuntimeError("Anthropic API 返回为空")
    return content


def _call_openai_compatible(prompt: str, settings: dict[str, Any]) -> str:
    api_key = settings["apiKey"]
    if not api_key:
        raise RuntimeError(f"缺少 API Key（{settings.get('provider', 'openai')}）")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("未安装 openai SDK，请先执行: pip install openai") from exc

    default_urls = {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
    }
    default_models = {
        "openai": "gpt-4o",
        "deepseek": "deepseek-chat",
    }

    provider = settings.get("provider", "openai")
    base_url = settings.get("baseUrl") or default_urls.get(provider, "https://api.openai.com/v1")
    model = settings.get("model") or default_models.get(provider, "gpt-4o")

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )

    content = response.choices[0].message.content
    if not content or not content.strip():
        raise RuntimeError(f"{provider} API 返回为空")
    return content.strip()


def call_ai(prompt: str, repo_root: Path) -> str:
    settings = load_ai_settings(repo_root)
    provider = settings.get("provider", "anthropic")
    if provider == "anthropic":
        return _call_anthropic(prompt, settings)
    return _call_openai_compatible(prompt, settings)


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    plan_dir = repo_root / "考研计划"
    config_path = repo_root / ".scripts" / "plan_config.json"
    error_root = repo_root / "考研数学" / "错题"

    config = load_json(config_path)

    today = date.today()
    weekday_names = config.get("weekday_names") or ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    weekday_name = weekday_names[today.weekday()]

    output_path = plan_dir / f"{today.isoformat()} {weekday_name}.md"
    if output_path.exists():
        print(f"[SKIP] 今日计划已存在: {output_path}")
        return 0

    phase = determine_phase(today, config.get("phases", []))
    allocation_desc = format_allocation(phase.get("allocation", {}))

    yesterday = today - timedelta(days=1)
    yesterday_file = find_plan_file_for_date(plan_dir, yesterday)
    yesterday_stats = parse_yesterday_stats(yesterday_file)

    due_counts = scan_due_error_reviews(error_root, config.get("error_intervals", {}), today)
    milestones = config.get("milestones", {}).get(today.strftime("%Y.%m"), [])

    prompt = build_prompt(
        today=today,
        weekday_name=weekday_name,
        phase=phase,
        allocation_desc=allocation_desc,
        yesterday_stats=yesterday_stats,
        due_counts=due_counts,
        milestones=milestones,
    )

    content = call_ai(prompt, repo_root)

    plan_dir.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content.rstrip() + "\n", encoding="utf-8")
    print(f"[OK] 已生成计划: {output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
