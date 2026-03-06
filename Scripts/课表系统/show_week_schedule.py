from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

from schedule_parser import (
    DEFAULT_SCHEDULE_FILE,
    WEEKDAY_CN,
    format_course_info,
    get_current_week,
    get_semester_end_date,
    get_semester_start_date,
    get_semester_total_weeks,
    get_week_date_range,
    get_week_label,
    get_week_schedule,
    is_week_in_semester,
    load_schedule_data,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Show timetable for a specific week.")
    parser.add_argument("--week", type=int, help="Week number to show.")
    parser.add_argument("--current", action="store_true", help="Show current week schedule.")
    parser.add_argument(
        "--date", default="", help="Reference date for --current in YYYY-MM-DD (optional)."
    )
    parser.add_argument(
        "--schedule-file", default=str(DEFAULT_SCHEDULE_FILE), help="Path to schedule JSON."
    )
    parser.add_argument("--output", default="", help="Optional output markdown file.")
    parser.add_argument(
        "--all-weeks",
        action="store_true",
        help="Generate all semester weeks (1..18). Useful for long markdown export.",
    )
    return parser.parse_args()


def resolve_date(date_str: str) -> date:
    if not date_str:
        return date.today()
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def _week_range_cn(week_num: int) -> str:
    week_start, week_end = get_week_date_range(week_num)
    return f"{week_start.month}月{week_start.day}日-{week_end.month}月{week_end.day}日"


def _week_nav_line(total_weeks: int, current_week: int) -> str:
    links: list[str] = []
    for week_num in range(1, total_weeks + 1):
        link = f"[第{week_num}周](#第{week_num}周)"
        if week_num == current_week:
            link = f"**[🔆第{week_num}周](#第{week_num}周)**"
        links.append(link)
    return " | ".join(links)


def _progress_bar(current_week: int, total_weeks: int, width: int = 20) -> tuple[str, int, float]:
    clamped_week = max(0, min(current_week, total_weeks))
    ratio = clamped_week / total_weeks if total_weeks > 0 else 0.0
    filled = int(round(ratio * width))
    bar = "▓" * filled + "░" * (width - filled)
    return bar, clamped_week, ratio * 100


def week_markdown(week_num: int, schedule_file: Path, current_week: int) -> str:
    week_range_cn = _week_range_cn(week_num)
    is_current = week_num == current_week
    lines = [f"## 第{week_num}周", ""]

    weekly = get_week_schedule(week_num, schedule_file=schedule_file)
    if is_current:
        lines.append(f"> [!tip] 🔆 第{week_num}周（当前周）")
        lines.append(f"> **时间范围**：{week_range_cn}")
        lines.append(">")
        for day_idx in range(1, 8):
            day_name = WEEKDAY_CN[day_idx - 1]
            lines.append(f"> ### {day_name}")
            day_courses = weekly.get(day_name, [])
            if not day_courses:
                lines.append("> - 无课程")
            else:
                for line in format_course_info(
                    day_courses, include_location=True, include_teacher=True
                ).splitlines():
                    lines.append(f"> {line}")
            lines.append(">")
    else:
        lines.append(f"**时间范围**：{week_range_cn}")
        lines.append("")
        for day_idx in range(1, 8):
            day_name = WEEKDAY_CN[day_idx - 1]
            lines.append(f"### {day_name}")
            day_courses = weekly.get(day_name, [])
            if not day_courses:
                lines.append("- 无课程")
            else:
                lines.extend(
                    format_course_info(
                        day_courses, include_location=True, include_teacher=True
                    ).splitlines()
                )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def semester_markdown(schedule_file: Path, reference_date: date | None = None) -> str:
    data = load_schedule_data(schedule_file)
    semester = str(data.get("semester", "2025-2026-2"))
    class_name = str(data.get("class_name", "通信2311"))
    start = get_semester_start_date()
    end = get_semester_end_date()
    total = get_semester_total_weeks()
    semester_title = _pretty_semester_title(semester)
    target_date = reference_date or date.today()
    current_week = get_current_week(target_date)
    current_week_label = get_week_label(current_week)
    nav_line = _week_nav_line(total, current_week)
    progress_bar, clamped_week, progress_percent = _progress_bar(current_week, total)
    remaining_weeks = max(0, total - clamped_week)

    if is_week_in_semester(current_week):
        current_start, current_end = get_week_date_range(current_week)
        current_hint = (
            f"> 📅 **当前：{current_week_label}**（{current_start:%Y-%m-%d} 至 {current_end:%Y-%m-%d}）"
        )
    else:
        current_hint = f"> 📅 **当前：{current_week_label}**"

    lines = [
        f"# {semester_title}课表 - {class_name}",
        "",
        f"学期时间：{start.year}年{start.month}月{start.day}日 - {end.year}年{end.month}月{end.day}日（共{total}周）",
        "",
        current_hint,
        "",
        "## 📑 周次导航",
        "",
        nav_line,
        "",
        "---",
        "",
        "## 📊 学期进度",
        "",
        f"- 学期开始：{start:%Y-%m-%d}",
        f"- 当前周次：{current_week_label} / 共{total}周",
        f"- 进度：{progress_bar} {progress_percent:.1f}%",
        f"- 剩余周数：{remaining_weeks}周",
        "",
    ]
    for week_num in range(1, total + 1):
        lines.append(week_markdown(week_num, schedule_file, current_week).rstrip())
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def terminal_output(week_num: int, schedule_file: Path) -> str:
    week_start, week_end = get_week_date_range(week_num)
    lines = [
        f"{get_week_label(week_num)} ({week_start:%Y-%m-%d} ~ {week_end:%Y-%m-%d})",
        "",
    ]
    weekly = get_week_schedule(week_num, schedule_file=schedule_file)
    for day_idx in range(1, 8):
        day_name = WEEKDAY_CN[day_idx - 1]
        lines.append(day_name)
        day_courses = weekly.get(day_name, [])
        if not day_courses:
            lines.append("  - 无课程")
        else:
            for line in format_course_info(
                day_courses, include_location=True, include_teacher=True
            ).splitlines():
                lines.append("  " + line)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _pretty_semester_title(semester: str) -> str:
    # "2025-2026-2" -> "2025-2026学年第2学期"
    parts = semester.strip().split("-")
    if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit() and parts[2].isdigit():
        return f"{parts[0]}-{parts[1]}学年第{parts[2]}学期"
    return f"{semester}学期"


def main() -> None:
    args = parse_args()
    schedule_file = Path(args.schedule_file)
    output = Path(args.output) if args.output else None
    reference_date = resolve_date(args.date)

    if args.all_weeks:
        content = semester_markdown(schedule_file, reference_date=reference_date)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(content, encoding="utf-8")
            print(f"Generated semester markdown: {output}")
        else:
            print(content)
        return

    if args.week is not None:
        week_num = args.week
    elif args.current:
        week_num = get_current_week(reference_date)
    else:
        week_num = get_current_week(reference_date)

    if not is_week_in_semester(week_num):
        print(f"{get_week_label(week_num)}（week={week_num}）")
        return

    if output:
        content = week_markdown(week_num, schedule_file, current_week=week_num)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
        print(f"Generated week markdown: {output}")
    else:
        print(terminal_output(week_num, schedule_file))


if __name__ == "__main__":
    main()
