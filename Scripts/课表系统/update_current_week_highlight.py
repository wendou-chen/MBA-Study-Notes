from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

from schedule_parser import DEFAULT_SCHEDULE_FILE
from show_week_schedule import semester_markdown

DEFAULT_VAULT_PATH = Path("/mnt/d/a考研/Obsidian Vault")
DEFAULT_WEEK_SCHEDULE_FILE = DEFAULT_VAULT_PATH / "课程" / "本学期课表-按周显示.md"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh current-week highlight and week navigation in semester schedule markdown."
    )
    parser.add_argument(
        "--schedule-file",
        default=str(DEFAULT_WEEK_SCHEDULE_FILE),
        help="Target markdown file (default: 课程/本学期课表-按周显示.md).",
    )
    parser.add_argument(
        "--schedule-json",
        default=str(DEFAULT_SCHEDULE_FILE),
        help="Source timetable JSON file.",
    )
    parser.add_argument(
        "--date",
        default="",
        help="Reference date for week highlight in YYYY-MM-DD (optional, defaults to today).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing.")
    return parser.parse_args()


def resolve_date(date_str: str) -> date:
    if not date_str:
        return date.today()
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def refresh_schedule_highlight(
    schedule_file: Path,
    schedule_json: Path,
    reference_date: date | None = None,
    dry_run: bool = False,
) -> tuple[bool, str]:
    target_date = reference_date or date.today()
    old_content = ""
    if schedule_file.exists():
        old_content = schedule_file.read_text(encoding="utf-8")

    new_content = semester_markdown(schedule_json, reference_date=target_date)
    changed = old_content != new_content

    if not dry_run:
        schedule_file.parent.mkdir(parents=True, exist_ok=True)
        schedule_file.write_text(new_content, encoding="utf-8")

    return changed, new_content


def main() -> None:
    args = parse_args()
    schedule_file = Path(args.schedule_file)
    schedule_json = Path(args.schedule_json)
    target_date = resolve_date(args.date)

    changed, content = refresh_schedule_highlight(
        schedule_file=schedule_file,
        schedule_json=schedule_json,
        reference_date=target_date,
        dry_run=args.dry_run,
    )

    if args.dry_run:
        print(content)
        print(f"\n[dry-run] {'changed' if changed else 'no-change'}: {schedule_file}")
    else:
        print(f"{'Updated' if changed else 'Already latest'}: {schedule_file}")


if __name__ == "__main__":
    main()
