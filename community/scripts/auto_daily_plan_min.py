#!/usr/bin/env python3
"""Community minimal daily plan generator for Obsidian."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

TODO_RE = re.compile(r"^- \[ \]\s*(.+)$", re.MULTILINE)
DONE_RE = re.compile(r"^- \[[xX]\]\s*(.+)$", re.MULTILINE)

SUBJECT_LABEL = {
    "math": "数学",
    "major": "专业课",
    "english": "英语",
    "politics": "政治",
    "review": "复盘",
}

SUBJECT_EMOJI = {
    "math": "🧮",
    "major": "📡",
    "english": "📝",
    "politics": "📚",
    "review": "📊",
}

TIME_BLOCKS = [
    ("08:00", "10:00"),
    ("10:20", "12:00"),
    ("14:00", "16:00"),
    ("16:20", "18:00"),
    ("19:00", "21:00"),
    ("21:10", "21:40"),
]


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def choose_phase(today: date, phases: list[dict[str, Any]]) -> dict[str, Any]:
    if not phases:
        raise ValueError("config missing phases")
    for phase in phases:
        start = parse_date(phase["start"])
        end = parse_date(phase["end"])
        if start <= today <= end:
            return phase
    return phases[-1]


def get_weekday_name(today: date, weekday_names: list[str] | None) -> str:
    names = weekday_names or ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    return names[today.weekday()]


def find_yesterday_file(plan_dir: Path, today: date) -> Path | None:
    yesterday = today - timedelta(days=1)
    candidates = sorted(plan_dir.glob(f"{yesterday.isoformat()} *.md"))
    return candidates[0] if candidates else None


def parse_yesterday_stats(path: Path | None, carry_limit: int) -> tuple[list[str], float]:
    if path is None or not path.exists():
        return ([], 0.0)

    text = path.read_text(encoding="utf-8")
    todo = [line.strip() for line in TODO_RE.findall(text) if line.strip()]
    done = DONE_RE.findall(text)
    total = len(todo) + len(done)
    completion_rate = (len(done) / total) if total else 0.0
    return (todo[:carry_limit], completion_rate)


def build_subject_sequence(allocation: dict[str, float]) -> list[str]:
    sorted_pairs = sorted(allocation.items(), key=lambda item: item[1], reverse=True)
    subjects = [key for key, _ in sorted_pairs if key in SUBJECT_LABEL]
    if not subjects:
        subjects = ["math", "major", "english", "review"]
    return subjects


def build_plan_blocks(
    allocation: dict[str, float],
    templates: dict[str, str],
) -> list[tuple[str, str, str, str, str]]:
    subjects = build_subject_sequence(allocation)
    blocks: list[tuple[str, str, str, str, str]] = []

    for idx, (start, end) in enumerate(TIME_BLOCKS):
        if idx == len(TIME_BLOCKS) - 1 and "review" in subjects:
            subject = "review"
        else:
            subject = subjects[idx % len(subjects)]

        label = SUBJECT_LABEL.get(subject, subject)
        emoji = SUBJECT_EMOJI.get(subject, "📌")
        task = templates.get(subject, f"{label}重点任务")
        blocks.append((start, end, emoji, label, task))

    return blocks


def render_markdown(
    today: date,
    weekday_name: str,
    phase: dict[str, Any],
    carry_tasks: list[str],
    yesterday_rate: float,
    blocks: list[tuple[str, str, str, str, str]],
) -> str:
    prev_day = today - timedelta(days=1)
    next_day = today + timedelta(days=1)
    prev_label = f"{prev_day.isoformat()} {get_weekday_name(prev_day, None)}"
    next_label = f"{next_day.isoformat()} {get_weekday_name(next_day, None)}"

    carry_lines = "\n".join(f"- [ ] {task}" for task in carry_tasks) if carry_tasks else "- [ ] 无昨日未完成任务"
    block_lines = "\n".join(
        f"- [ ] {start} - {end} | {emoji} {label} | {task}"
        for start, end, emoji, label, task in blocks
    )

    return (
        f"---\n"
        f"date: {today.isoformat()}\n"
        f"weekday: {weekday_name}\n"
        f"phase: \"Phase {phase['id']} - {phase['name']}\"\n"
        f"type: daily-plan\n"
        f"status: pending\n"
        f"tags:\n"
        f"  - kaoyan\n"
        f"  - daily-plan\n"
        f"---\n\n"
        f"# 📝 {today.strftime('%m.%d')} {weekday_name} · 社区版学习计划\n\n"
        f"> [!tip] 今日重点\n"
        f"> 先完成数学和专业课主任务，晚间统一复盘并回收错题。\n\n"
        f"## 昨日延续\n"
        f"- 昨日完成率：{yesterday_rate:.1%}\n"
        f"{carry_lines}\n\n"
        f"## 时间块任务\n"
        f"{block_lines}\n\n"
        f"## 晚间复盘\n"
        f"| 指标 | 计划 | 实际 |\n"
        f"| --- | --- | --- |\n"
        f"| 总完成率 | >= 80% | |\n"
        f"| 数学专注时长 | >= 3h | |\n"
        f"| 今日新增错题 | <= 5题 | |\n\n"
        f"## 关联\n"
        f"- 上一日：[[{prev_label}]]\n"
        f"- 下一日：[[{next_label}]]\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate minimal daily plan markdown.")
    parser.add_argument("--date", default=date.today().isoformat(), help="target date, format YYYY-MM-DD")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parents[1] / "config" / "plan_config.example.json"),
        help="path to plan config json",
    )
    parser.add_argument("--output-dir", default="考研计划", help="output directory for generated plan")
    parser.add_argument("--carry-limit", type=int, default=5, help="max carry-over tasks from yesterday")
    parser.add_argument("--force", action="store_true", help="overwrite output file if exists")
    args = parser.parse_args()

    today = parse_date(args.date)
    config_path = Path(args.config)
    output_dir = Path(args.output_dir)

    config = load_config(config_path)
    phase = choose_phase(today, config.get("phases", []))
    weekday_name = get_weekday_name(today, config.get("weekday_names"))
    templates = config.get("subject_templates", {})

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{today.isoformat()} {weekday_name}.md"
    if output_path.exists() and not args.force:
        print(f"[SKIP] output exists: {output_path}")
        return 0

    yesterday_file = find_yesterday_file(output_dir, today)
    carry_tasks, yesterday_rate = parse_yesterday_stats(yesterday_file, args.carry_limit)
    blocks = build_plan_blocks(phase.get("allocation", {}), templates)
    content = render_markdown(today, weekday_name, phase, carry_tasks, yesterday_rate, blocks)
    output_path.write_text(content, encoding="utf-8")
    print(f"[OK] generated: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

