from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from archive_old_notes import archive_old_notes
from schedule_parser import (
    DEFAULT_HOLIDAYS_FILE,
    WEEKDAY_CN,
    format_course_info,
    get_courses_for_date,
    get_current_week,
    get_holiday_name,
    get_makeup_day_info,
    get_week_label,
)
from update_current_week_highlight import refresh_schedule_highlight

DEFAULT_JSON = Path(__file__).resolve().parent / "通信2311_课表.json"
DEFAULT_VAULT_PATH = Path("/mnt/d/a考研/Obsidian Vault")
DEFAULT_TEMPLATE = DEFAULT_VAULT_PATH / "Templates" / "每日课程.md"
DEFAULT_WEEK_SCHEDULE_NOTE = DEFAULT_VAULT_PATH / "课程" / "本学期课表-按周显示.md"


def detect_daily_dir(vault_path: Path) -> str:
    config_path = vault_path / ".obsidian" / "daily-notes.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(config, dict):
                folder = str(config.get("folder", "")).strip()
                if folder:
                    return folder
                return "."
        except (OSError, json.JSONDecodeError):
            pass
    return "Daily Notes"


def parse_args() -> argparse.Namespace:
    default_vault_path = Path(os.getenv("OBSIDIAN_VAULT_PATH", str(DEFAULT_VAULT_PATH)))
    default_daily_dir = os.getenv("OBSIDIAN_DAILY_DIR", detect_daily_dir(default_vault_path))
    default_template_path = os.getenv("OBSIDIAN_TEMPLATE_FILE", str(DEFAULT_TEMPLATE))
    default_week_schedule_note = os.getenv(
        "OBSIDIAN_WEEK_SCHEDULE_FILE", str(DEFAULT_WEEK_SCHEDULE_NOTE)
    )

    parser = argparse.ArgumentParser(
        description="Update Obsidian Daily Note with dynamic week and holiday-aware reminders."
    )
    parser.add_argument("--vault-path", default=str(default_vault_path), help="Obsidian vault path.")
    parser.add_argument("--daily-dir", default=default_daily_dir, help="Daily notes folder in vault.")
    parser.add_argument("--schedule-file", default=str(DEFAULT_JSON), help="Timetable JSON path.")
    parser.add_argument(
        "--template-file", default=default_template_path, help="Daily note template path."
    )
    parser.add_argument(
        "--holidays-file",
        default=str(DEFAULT_HOLIDAYS_FILE),
        help="Holiday config JSON path.",
    )
    parser.add_argument("--date", default="", help="Target date (YYYY-MM-DD).")
    parser.add_argument(
        "--week-schedule-note",
        default=default_week_schedule_note,
        help="Semester weekly schedule markdown path for current-week highlighting.",
    )
    parser.add_argument(
        "--skip-week-highlight",
        action="store_true",
        help="Skip auto-update of current-week highlight in semester schedule note.",
    )
    parser.add_argument(
        "--reminder-time",
        default="07:00",
        help="Reminder time for generated task (HH:MM). Defaults to 07:00.",
    )
    parser.add_argument(
        "--reminder-for",
        choices=["auto", "today", "tomorrow"],
        default="auto",
        help="Reminder target day. auto: 07:00->today, others->tomorrow.",
    )
    parser.add_argument("--startup", action="store_true", help="Startup mode: only show today courses.")
    parser.add_argument("--dry-run", action="store_true", help="Print content without writing.")
    parser.add_argument(
        "--archive-days",
        type=int,
        default=30,
        help="Archive notes older than N days on each run (default: 30).",
    )
    parser.add_argument(
        "--skip-archive", action="store_true", help="Skip automatic archive check for this run."
    )
    parser.add_argument(
        "--archive-dry-run",
        action="store_true",
        help="Preview archive operation without moving files.",
    )
    return parser.parse_args()


def resolve_target_date(date_str: str) -> date:
    if not date_str:
        return date.today()
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def ensure_daily_note(note_path: Path, template_file: Path, target_date: date) -> str:
    if note_path.exists():
        return note_path.read_text(encoding="utf-8")

    if template_file.exists():
        content = template_file.read_text(encoding="utf-8")
    else:
        content = (
            "---\n"
            f"date: {target_date:%Y-%m-%d}\n"
            "week: 第X周\n"
            "---\n\n"
            f"# {target_date:%Y-%m-%d} - 第X周\n\n"
            "## 📚 今天的课程\n<!-- AUTO_TODAY_START -->\n（自动填充）\n<!-- AUTO_TODAY_END -->\n\n"
            "## 📅 明天预告\n<!-- AUTO_TOMORROW_START -->\n（自动填充）\n<!-- AUTO_TOMORROW_END -->\n\n"
            "## ⏰ 提醒\n<!-- AUTO_REMINDER_START -->\n（自动填充）\n<!-- AUTO_REMINDER_END -->\n"
        )

    note_path.parent.mkdir(parents=True, exist_ok=True)
    note_path.write_text(content, encoding="utf-8")
    return content


def update_frontmatter_and_title(content: str, target_date: date, week_label: str) -> str:
    date_value = target_date.strftime("%Y-%m-%d")
    weekday_name = WEEKDAY_CN[target_date.weekday()]
    title_line = f"# {date_value} - {week_label} {weekday_name}"

    if content.startswith("---\n"):
        end_pos = content.find("\n---\n", 4)
        if end_pos != -1:
            header = content[4:end_pos]
            body = content[end_pos + 5 :]
            lines = [line for line in header.splitlines() if line.strip()]
            updated: list[str] = []
            seen_date = False
            seen_week = False
            for line in lines:
                if line.startswith("date:"):
                    updated.append(f"date: {date_value}")
                    seen_date = True
                elif line.startswith("week:"):
                    updated.append(f"week: {week_label}")
                    seen_week = True
                else:
                    updated.append(line)
            if not seen_date:
                updated.append(f"date: {date_value}")
            if not seen_week:
                updated.append(f"week: {week_label}")
            content = "---\n" + "\n".join(updated) + "\n---\n" + body
    else:
        content = f"---\ndate: {date_value}\nweek: {week_label}\n---\n\n" + content

    if re.search(r"(?m)^# .*$", content):
        content = re.sub(r"(?m)^# .*$", title_line, content, count=1)
    else:
        if not content.endswith("\n"):
            content += "\n"
        content += "\n" + title_line + "\n"
    return content


def format_course_lines(courses: list[dict]) -> list[str]:
    if not courses:
        return ["- 无课程"]
    formatted = format_course_info(courses, include_location=True, include_teacher=False)
    return formatted.splitlines()


def _build_day_context(target_date: date, holidays_file: Path) -> tuple[str | None, dict | None]:
    holiday_name = get_holiday_name(target_date, holidays_file=holidays_file)
    makeup_info = get_makeup_day_info(target_date, holidays_file=holidays_file)
    # Makeup day takes precedence over holiday definition for scheduling behavior.
    if makeup_info:
        return None, makeup_info
    return holiday_name, None


def build_day_lines(
    target_date: date, courses: list[dict], prefix: str, holidays_file: Path
) -> list[str]:
    holiday_name, makeup_info = _build_day_context(target_date, holidays_file)
    week_num = get_current_week(target_date)
    week_label = get_week_label(week_num)
    weekday_name = WEEKDAY_CN[target_date.weekday()]

    if holiday_name:
        return [f"{prefix}是{holiday_name}，放假无课。"]

    if makeup_info:
        makeup_for_date = datetime.strptime(makeup_info["makeup_for"], "%Y-%m-%d").date()
        makeup_week_label = get_week_label(get_current_week(makeup_for_date))
        makeup_weekday_name = WEEKDAY_CN[makeup_for_date.weekday()]
        header = (
            f"{prefix}补{makeup_for_date:%Y-%m-%d}（{makeup_week_label}{makeup_weekday_name}）的课，"
            f"有{len(courses)}节课："
        )
        if makeup_info.get("note"):
            header += f"（{makeup_info['note']}）"
        return [header] + format_course_lines(courses)

    return [f"{prefix}是{week_label}{weekday_name}，有{len(courses)}节课："] + format_course_lines(courses)


def _build_label_for_reminder(target_date: date, holidays_file: Path) -> tuple[str, bool]:
    holiday_name, makeup_info = _build_day_context(target_date, holidays_file)
    if holiday_name:
        return holiday_name, True
    if makeup_info:
        makeup_for_date = datetime.strptime(makeup_info["makeup_for"], "%Y-%m-%d").date()
        makeup_week_label = get_week_label(get_current_week(makeup_for_date))
        makeup_weekday_name = WEEKDAY_CN[makeup_for_date.weekday()]
        return f"补{makeup_week_label}{makeup_weekday_name}", False
    week_label = get_week_label(get_current_week(target_date))
    weekday_name = WEEKDAY_CN[target_date.weekday()]
    return f"{week_label}{weekday_name}", False


def build_reminder_line(
    target_date: date, target_text: str, courses: list[dict], reminder_time: str, holidays_file: Path
) -> str:
    label, is_holiday_flag = _build_label_for_reminder(target_date, holidays_file)
    if is_holiday_flag:
        return f"- [ ] {target_text}（{label}）放假无课 📅 {target_date:%Y-%m-%d} @{reminder_time}"

    course_names: list[str] = []
    seen = set()
    for course in courses:
        name = str(course.get("name", "")).strip()
        if name and name not in seen:
            seen.add(name)
            course_names.append(name)
    summary = "、".join(course_names) if course_names else "无课程"
    return (
        f"- [ ] {target_text}（{label}）有{len(courses)}节课：{summary} "
        f"📅 {target_date:%Y-%m-%d} @{reminder_time}"
    )


def resolve_reminder_target(reminder_for: str, reminder_time: str) -> str:
    if reminder_for in {"today", "tomorrow"}:
        return reminder_for
    return "today" if reminder_time == "07:00" else "tomorrow"


def replace_block(content: str, start_tag: str, end_tag: str, lines: list[str]) -> str:
    block = start_tag + "\n" + "\n".join(lines) + "\n" + end_tag
    if start_tag in content and end_tag in content:
        prefix, rest = content.split(start_tag, 1)
        _, suffix = rest.split(end_tag, 1)
        return prefix + block + suffix
    if not content.endswith("\n"):
        content += "\n"
    return content + "\n" + block + "\n"


def upsert_reminder_block(content: str, reminder_line: str) -> str:
    start_tag = "<!-- AUTO_REMINDER_START -->"
    end_tag = "<!-- AUTO_REMINDER_END -->"
    existing_lines: list[str] = []

    if start_tag in content and end_tag in content:
        _, rest = content.split(start_tag, 1)
        body, _ = rest.split(end_tag, 1)
        existing_lines = [line.rstrip() for line in body.splitlines() if line.strip()]

    existing_lines = [
        line
        for line in existing_lines
        if line.startswith("- [ ] ")
        and "<%" not in line
        and "自动填充" not in line
        and _keep_reminder_time(line)
    ]
    if reminder_line not in existing_lines:
        existing_lines.append(reminder_line)
    existing_lines = _unique_sorted_reminder_lines(existing_lines)
    return replace_block(content, start_tag, end_tag, existing_lines)


def _unique_sorted_reminder_lines(lines: list[str]) -> list[str]:
    seen = set()
    uniq = []
    for line in lines:
        if line in seen:
            continue
        seen.add(line)
        uniq.append(line)
    return sorted(uniq, key=_reminder_sort_key)


def _reminder_sort_key(line: str) -> tuple[str, str, str]:
    match = re.search(r"📅\s*(\d{4}-\d{2}-\d{2})\s*@(\d{2}:\d{2})", line)
    if not match:
        return ("9999-12-31", "99:99", line)
    return (match.group(1), match.group(2), line)


def _keep_reminder_time(line: str) -> bool:
    match = re.search(r"@\s*(\d{2}:\d{2})", line)
    if not match:
        return False
    return match.group(1) in {"07:00", "22:00"}


def _daily_note_path(vault_path: Path, daily_dir: str, target_date: date) -> Path:
    if daily_dir.strip() in {"", ".", "/"}:
        return vault_path / f"{target_date:%Y-%m-%d}.md"
    return vault_path / daily_dir / f"{target_date:%Y-%m-%d}.md"


def run_startup_mode(target_date: date, schedule_file: Path, holidays_file: Path) -> None:
    courses = get_courses_for_date(
        target_date,
        schedule_file=schedule_file,
        filter_by_week=True,
        holidays_file=holidays_file,
    )
    lines = build_day_lines(target_date, courses, "今天", holidays_file)
    print("\n".join(lines))


def update_daily_note(
    vault_path: Path,
    daily_dir: str,
    schedule_file: Path,
    template_file: Path,
    holidays_file: Path,
    target_date: date,
    reminder_time: str,
    reminder_for: str,
    dry_run: bool,
) -> tuple[Path, str]:
    if not vault_path.exists():
        raise FileNotFoundError(f"vault path does not exist: {vault_path}")
    if len(reminder_time) != 5 or reminder_time[2] != ":":
        raise ValueError("reminder time must be HH:MM format, e.g. 07:00")

    note_path = _daily_note_path(vault_path, daily_dir, target_date)
    content = ensure_daily_note(note_path, template_file, target_date)

    week_num = get_current_week(target_date)
    week_label = get_week_label(week_num)
    content = update_frontmatter_and_title(content, target_date, week_label)

    today_courses = get_courses_for_date(
        target_date,
        schedule_file=schedule_file,
        filter_by_week=True,
        holidays_file=holidays_file,
    )
    tomorrow = target_date + timedelta(days=1)
    tomorrow_courses = get_courses_for_date(
        tomorrow,
        schedule_file=schedule_file,
        filter_by_week=True,
        holidays_file=holidays_file,
    )

    today_lines = build_day_lines(target_date, today_courses, "今天", holidays_file)
    tomorrow_lines = build_day_lines(tomorrow, tomorrow_courses, "明天", holidays_file)
    content = replace_block(
        content, "<!-- AUTO_TODAY_START -->", "<!-- AUTO_TODAY_END -->", today_lines
    )
    content = replace_block(
        content, "<!-- AUTO_TOMORROW_START -->", "<!-- AUTO_TOMORROW_END -->", tomorrow_lines
    )

    reminder_target = resolve_reminder_target(reminder_for, reminder_time)
    if reminder_target == "today":
        reminder_date = target_date
        reminder_courses = today_courses
        reminder_text = "今天"
    else:
        reminder_date = tomorrow
        reminder_courses = tomorrow_courses
        reminder_text = "明天"

    reminder_line = build_reminder_line(
        reminder_date, reminder_text, reminder_courses, reminder_time, holidays_file
    )
    content = upsert_reminder_block(content, reminder_line)

    if not dry_run:
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text(content, encoding="utf-8")
    return note_path, content


def main() -> None:
    args = parse_args()
    target_date = resolve_target_date(args.date)

    vault_path = Path(args.vault_path)
    daily_dir = args.daily_dir
    schedule_file = Path(args.schedule_file)
    template_file = Path(args.template_file)
    holidays_file = Path(args.holidays_file)
    week_schedule_note = Path(args.week_schedule_note)

    if not args.skip_week_highlight:
        try:
            changed, _ = refresh_schedule_highlight(
                schedule_file=week_schedule_note,
                schedule_json=schedule_file,
                reference_date=target_date,
                dry_run=args.dry_run,
            )
            state = "updated" if changed else "already latest"
            print(f"Week highlight {state}: {week_schedule_note}")
        except Exception as exc:
            print(f"WARN: failed to refresh week highlight: {exc}")

    if not args.skip_archive:
        archive_old_notes(
            vault_path=vault_path,
            daily_dir=daily_dir,
            days=args.archive_days,
            dry_run=args.archive_dry_run or args.dry_run,
            auto=True,
            today=date.today(),
        )

    if args.startup:
        run_startup_mode(target_date, schedule_file=schedule_file, holidays_file=holidays_file)
        return

    note_path, content = update_daily_note(
        vault_path=vault_path,
        daily_dir=daily_dir,
        schedule_file=schedule_file,
        template_file=template_file,
        holidays_file=holidays_file,
        target_date=target_date,
        reminder_time=args.reminder_time,
        reminder_for=args.reminder_for,
        dry_run=args.dry_run,
    )
    print(f"Daily note updated: {note_path}")
    if args.dry_run:
        print("\n--- DRY RUN CONTENT ---\n")
        print(content)


if __name__ == "__main__":
    main()
