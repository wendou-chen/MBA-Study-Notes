# Obsidian Timetable System (Optimized)

Location:
- Vault: `/mnt/d/a考研/Obsidian Vault`
- Scripts: `/mnt/d/a考研/Obsidian Vault/Scripts/课表系统`

## 1. Reminder Time (Updated)

New schedule:
- `07:00`: morning reminder for **today's** courses
- `22:00`: night reminder for **tomorrow's** courses

Launcher scripts:
- `update_daily_07.bat` / `update_daily_07.sh`
- `update_daily_22.bat` / `update_daily_22.sh`

## 2. Group Display Rules

Implemented in `schedule_parser.py` (`format_course_info` and merge logic):

- `大学体育6`
  - merged and simplified to one line
  - no teacher/location/group shown
  - example: `- 第5-6节（14:30-16:10）：大学体育6`
- `...[实验学时]`
  - group entries are kept (not over-merged)
  - group label shown as `[分组01]` / `[分组02]`
  - includes location and teacher in formatted output

## 3. Holiday and Makeup Config

Config file:
- `holidays.json`

Supported functions in `schedule_parser.py`:
- `load_holidays()`
- `is_holiday(date)`
- `get_makeup_day_info(date)`

Behavior:
- holiday date: no classes returned
- makeup day: classes are mapped from `makeup_for` date

## 4. Daily Update Script

File:
- `obsidian_daily_update.py`

Key options:
- `--reminder-time HH:MM`
- `--reminder-for auto|today|tomorrow`
- `--startup` (show only today's courses, no reminder write)
- `--archive-days N` (default 30)
- `--skip-archive`
- `--archive-dry-run`
- `--week-schedule-note PATH` (weekly schedule markdown to auto-refresh highlight)
- `--skip-week-highlight`

### Examples

07:00 run (today reminder):
```bash
python3 obsidian_daily_update.py --reminder-time 07:00 --reminder-for today
```

22:00 run (tomorrow reminder):
```bash
python3 obsidian_daily_update.py --reminder-time 22:00 --reminder-for tomorrow
```

Startup mode:
```bash
python3 obsidian_daily_update.py --startup
```

## 5. Old Note Archive

Script:
- `archive_old_notes.py`

Function:
- move Daily Notes older than N days into:
  - `Daily Notes/Archive/YYYY-MM/`

Options:
- `--days N` (default 30)
- `--dry-run`
- `--auto`

Examples:
```bash
python3 archive_old_notes.py --days 30 --dry-run
python3 archive_old_notes.py --days 30 --auto
```

Note:
- `obsidian_daily_update.py` runs archive check automatically each run by default.

## 6. Startup Scripts

Added:
- `startup.bat`
- `startup.sh`

Both run:
```bash
python3 obsidian_daily_update.py --startup
```

Suitable for OS startup task or Obsidian startup hook.

## 7. Week Query Tool

File:
- `show_week_schedule.py`

Examples:
```bash
python3 show_week_schedule.py --current
python3 show_week_schedule.py --week 3
python3 show_week_schedule.py --all-weeks --output "/mnt/d/a考研/Obsidian Vault/课程/本学期课表-按周显示.md"
```

Generated semester markdown now includes:
- week index navigation (`[第N周](#第N周)`)
- current week callout highlight
- top current-week hint and semester progress bar

## 8. Current Week Highlight Updater

File:
- `update_current_week_highlight.py`

Examples:
```bash
python3 update_current_week_highlight.py
python3 update_current_week_highlight.py --date 2026-03-10
python3 update_current_week_highlight.py --dry-run
```

Notes:
- The script refreshes `课程/本学期课表-按周显示.md` and ensures only one week is marked as current.
- `obsidian_daily_update.py` calls this updater automatically on each run (unless `--skip-week-highlight` is passed).

## 9. Windows Task Scheduler (Recommended)

Create two tasks:

1. Morning (`07:00`)
- Program: `python.exe`
- Arguments: `D:\a考研\Obsidian Vault\Scripts\课表系统\obsidian_daily_update.py --reminder-time 07:00 --reminder-for today`
- Start in: `D:\a考研\Obsidian Vault\Scripts\课表系统`

2. Night (`22:00`)
- Program: `python.exe`
- Arguments: `D:\a考研\Obsidian Vault\Scripts\课表系统\obsidian_daily_update.py --reminder-time 22:00 --reminder-for tomorrow`
- Start in: `D:\a考研\Obsidian Vault\Scripts\课表系统`
