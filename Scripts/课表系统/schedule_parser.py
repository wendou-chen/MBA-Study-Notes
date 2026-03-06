from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DEFAULT_SCHEDULE_FILE = Path(__file__).resolve().parent / "通信2311_课表.json"
DEFAULT_HOLIDAYS_FILE = Path(__file__).resolve().parent / "holidays.json"

SEMESTER_START_DATE = date(2026, 3, 2)
SEMESTER_TOTAL_WEEKS = 18

WEEKDAY_CN = {
    0: "星期一",
    1: "星期二",
    2: "星期三",
    3: "星期四",
    4: "星期五",
    5: "星期六",
    6: "星期天",
}

DAY_TO_INDEX = {name: index + 1 for index, name in WEEKDAY_CN.items()}

PERIOD_TO_TIME = {
    "0102": "08:00-09:40",
    "0304": "10:00-11:40",
    "0506": "14:30-16:10",
    "0708": "16:20-18:00",
    "0910": "19:00-20:40",
    "1112": "20:50-22:30",
}


def get_semester_start_date() -> date:
    return SEMESTER_START_DATE


def get_semester_total_weeks() -> int:
    return SEMESTER_TOTAL_WEEKS


def get_semester_end_date() -> date:
    return SEMESTER_START_DATE + timedelta(days=SEMESTER_TOTAL_WEEKS * 7 - 1)


def get_current_week(target_date: date | None = None) -> int:
    current = target_date or date.today()
    delta_days = (current - SEMESTER_START_DATE).days
    return delta_days // 7 + 1


def is_week_in_semester(week_num: int) -> bool:
    return 1 <= week_num <= SEMESTER_TOTAL_WEEKS


def get_week_label(week_num: int) -> str:
    if week_num < 1:
        return "学期未开始"
    if week_num > SEMESTER_TOTAL_WEEKS:
        return "学期已结束"
    return f"第{week_num}周"


def get_week_date_range(week_num: int) -> tuple[date, date]:
    week_start = SEMESTER_START_DATE + timedelta(days=(week_num - 1) * 7)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def load_schedule_data(schedule_file: str | Path = DEFAULT_SCHEDULE_FILE) -> dict[str, Any]:
    path = Path(schedule_file)
    if not path.exists():
        raise FileNotFoundError(f"Schedule file not found: {path}")

    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict) or "schedule" not in data:
        raise ValueError("Invalid schedule JSON: top-level 'schedule' field is required.")

    return data


def load_holidays(holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE) -> dict[str, Any]:
    path = Path(holidays_file)
    default_payload = {
        "holidays": [],
        "makeup_days": [],
        "holiday_by_date": {},
        "makeup_by_date": {},
    }
    if not path.exists():
        return default_payload

    with path.open("r", encoding="utf-8") as file:
        raw = json.load(file)

    holidays = raw.get("holidays", []) if isinstance(raw, dict) else []
    makeup_days = raw.get("makeup_days", []) if isinstance(raw, dict) else []

    holiday_by_date: dict[str, str] = {}
    for item in holidays:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        for d in item.get("dates", []) or []:
            if _is_iso_date(str(d)):
                holiday_by_date[str(d)] = name

    makeup_by_date: dict[str, dict[str, Any]] = {}
    for item in makeup_days:
        if not isinstance(item, dict):
            continue
        day = str(item.get("date", "")).strip()
        makeup_for = str(item.get("makeup_for", "")).strip()
        if not (_is_iso_date(day) and _is_iso_date(makeup_for)):
            continue
        makeup_by_date[day] = {
            "date": day,
            "makeup_for": makeup_for,
            "note": str(item.get("note", "")).strip(),
        }

    return {
        "holidays": holidays,
        "makeup_days": makeup_days,
        "holiday_by_date": holiday_by_date,
        "makeup_by_date": makeup_by_date,
    }


def is_holiday(target_date: date, holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE) -> bool:
    key = target_date.isoformat()
    holidays = load_holidays(holidays_file)
    return key in holidays.get("holiday_by_date", {})


def get_holiday_name(target_date: date, holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE) -> str | None:
    key = target_date.isoformat()
    holidays = load_holidays(holidays_file)
    return holidays.get("holiday_by_date", {}).get(key)


def get_makeup_day_info(
    target_date: date, holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE
) -> dict[str, Any] | None:
    key = target_date.isoformat()
    holidays = load_holidays(holidays_file)
    info = holidays.get("makeup_by_date", {}).get(key)
    if isinstance(info, dict):
        return info
    return None


def parse_schedule_data(schedule_file: str | Path = DEFAULT_SCHEDULE_FILE) -> list[dict[str, Any]]:
    data = load_schedule_data(schedule_file)
    raw_schedule = data.get("schedule")
    normalized: list[dict[str, Any]] = []

    if isinstance(raw_schedule, dict):
        for slot_key, courses in raw_schedule.items():
            if not isinstance(courses, list):
                continue
            day, time_code = _parse_slot_key(slot_key)
            for course in courses:
                if isinstance(course, dict):
                    normalized.append(_normalize_course(course, day, time_code))
    elif isinstance(raw_schedule, list):
        for course in raw_schedule:
            if not isinstance(course, dict):
                continue
            day = str(course.get("day") or course.get("weekday") or "").strip()
            time_code = str(course.get("time_code") or "").strip()
            normalized.append(_normalize_course(course, day, time_code))
    else:
        raise ValueError("Invalid schedule JSON: 'schedule' must be a dict or list.")

    normalized = [
        item
        for item in normalized
        if item.get("day") and item.get("period") and item.get("name") and item.get("time")
    ]
    return sorted(normalized, key=_course_sort_key)


def get_courses_by_week_and_day(
    week_num: int, day_index: int, schedule_file: str | Path = DEFAULT_SCHEDULE_FILE
) -> list[dict[str, Any]]:
    normalized_day_index = _normalize_day_index(day_index)
    if normalized_day_index is None or not is_week_in_semester(week_num):
        return []

    all_courses = parse_schedule_data(schedule_file)
    day_courses = [
        course
        for course in all_courses
        if course.get("day_index") == normalized_day_index and _course_in_week(course, week_num)
    ]
    return _merge_group_courses(day_courses)


def get_week_schedule(
    week_num: int, schedule_file: str | Path = DEFAULT_SCHEDULE_FILE
) -> dict[str, list[dict[str, Any]]]:
    schedule: dict[str, list[dict[str, Any]]] = {}
    for idx in range(1, 8):
        day_name = WEEKDAY_CN[idx - 1]
        schedule[day_name] = get_courses_by_week_and_day(week_num, idx, schedule_file=schedule_file)
    return schedule


def get_courses_for_date(
    target_date: date,
    schedule_file: str | Path = DEFAULT_SCHEDULE_FILE,
    filter_by_week: bool = True,
    holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE,
) -> list[dict[str, Any]]:
    makeup_info = get_makeup_day_info(target_date, holidays_file=holidays_file)
    if makeup_info:
        makeup_for = datetime.strptime(makeup_info["makeup_for"], "%Y-%m-%d").date()
        week_num = get_current_week(makeup_for)
        if filter_by_week and not is_week_in_semester(week_num):
            return []
        day_index = makeup_for.weekday() + 1
        return get_courses_by_week_and_day(week_num, day_index, schedule_file=schedule_file)

    if is_holiday(target_date, holidays_file=holidays_file):
        return []

    week_num = get_current_week(target_date)
    day_index = target_date.weekday() + 1
    if filter_by_week and not is_week_in_semester(week_num):
        return []
    if filter_by_week:
        return get_courses_by_week_and_day(week_num, day_index, schedule_file=schedule_file)

    all_courses = parse_schedule_data(schedule_file)
    weekday_name = WEEKDAY_CN[target_date.weekday()]
    day_courses = [course for course in all_courses if course.get("day") == weekday_name]
    return _merge_group_courses(day_courses)


def get_today_courses(
    schedule_file: str | Path = DEFAULT_SCHEDULE_FILE,
    filter_by_week: bool = True,
    holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE,
) -> list[dict[str, Any]]:
    return get_courses_for_date(
        date.today(),
        schedule_file=schedule_file,
        filter_by_week=filter_by_week,
        holidays_file=holidays_file,
    )


def get_tomorrow_courses(
    schedule_file: str | Path = DEFAULT_SCHEDULE_FILE,
    filter_by_week: bool = True,
    holidays_file: str | Path = DEFAULT_HOLIDAYS_FILE,
) -> list[dict[str, Any]]:
    return get_courses_for_date(
        date.today() + timedelta(days=1),
        schedule_file=schedule_file,
        filter_by_week=filter_by_week,
        holidays_file=holidays_file,
    )


def format_course_info(
    courses: list[dict[str, Any]], include_location: bool = False, include_teacher: bool = False
) -> str:
    if not courses:
        return "No courses."

    lines: list[str] = []
    for course in courses:
        period = str(course.get("period", "未知节次"))
        time_range = str(course.get("time", "未知时间"))
        name = str(course.get("name", "未知课程"))

        if _is_pe_course(name):
            lines.append(f"- {period}（{time_range}）：大学体育6")
            continue

        is_experiment = _is_experiment_course(name)
        line = f"- {period}（{time_range}）：{name}"

        location = str(course.get("location") or "").strip()
        teacher = str(course.get("teacher") or "").strip()
        if (include_location or is_experiment) and location and location != "(暂无教室)":
            line += f" - {location}"
        if (include_teacher or is_experiment) and teacher and teacher != "多位教师":
            line += f" - {teacher}"

        group_label = _extract_group_label(str(course.get("group") or ""))
        if is_experiment and group_label:
            line += f" [{group_label}]"
        elif int(course.get("group_count", 1) or 1) > 1:
            line += " [多个分组]"

        lines.append(line)
    return "\n".join(lines)


def format_date_cn(target_date: date) -> str:
    return f"{target_date.month}月{target_date.day}日 {WEEKDAY_CN[target_date.weekday()]}"


def _parse_slot_key(slot_key: Any) -> tuple[str, str]:
    if not isinstance(slot_key, str):
        return "", ""
    if "_" not in slot_key:
        return slot_key.strip(), ""
    day, time_code = slot_key.split("_", 1)
    return day.strip(), time_code.strip()


def _normalize_course(
    course: dict[str, Any], fallback_day: str = "", fallback_time_code: str = ""
) -> dict[str, Any]:
    day = str(course.get("day") or course.get("weekday") or fallback_day or "").strip()
    time_code = str(course.get("time_code") or fallback_time_code or "").strip()

    period = str(course.get("period") or _time_code_to_period(time_code) or "").strip()
    name = str(
        course.get("name") or course.get("course_name") or course.get("course") or ""
    ).strip()
    time_range = str(course.get("time") or course.get("time_range") or "").strip()
    if not time_range and time_code in PERIOD_TO_TIME:
        time_range = PERIOD_TO_TIME[time_code]

    day_index = course.get("day_index")
    if not isinstance(day_index, int):
        day_index = DAY_TO_INDEX.get(day, 0)

    weeks = _normalize_weeks(course.get("weeks"), str(course.get("week_str") or ""))
    week_str = str(course.get("week_str") or "").strip()
    if not week_str and weeks:
        week_str = _compact_week_str(weeks)

    return {
        "day": day,
        "day_index": day_index,
        "time_code": time_code,
        "period": period,
        "time": time_range,
        "name": name,
        "teacher": str(course.get("teacher") or "").strip(),
        "location": str(course.get("location") or "").strip(),
        "group": _extract_group_label(str(course.get("group") or "")),
        "week_str": week_str,
        "weeks": weeks,
    }


def _normalize_day_index(day_index: int) -> int | None:
    if 1 <= day_index <= 7:
        return day_index
    if 0 <= day_index <= 6:
        return day_index + 1
    return None


def _normalize_weeks(raw_weeks: Any, week_str: str) -> list[int]:
    if isinstance(raw_weeks, list):
        weeks = sorted({int(item) for item in raw_weeks if isinstance(item, int)})
        if weeks:
            return weeks
    return _parse_weeks_from_text(week_str)


def _parse_weeks_from_text(week_str: str) -> list[int]:
    if not week_str:
        return []
    weeks: set[int] = set()
    for token in re.split(r"[，,、]", week_str):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            parts = token.split("-", 1)
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                start = int(parts[0])
                end = int(parts[1])
                if start <= end:
                    weeks.update(range(start, end + 1))
        elif token.isdigit():
            weeks.add(int(token))
    return sorted(weeks)


def _compact_week_str(weeks: list[int]) -> str:
    if not weeks:
        return ""
    ranges: list[str] = []
    start = weeks[0]
    prev = weeks[0]
    for current in weeks[1:]:
        if current == prev + 1:
            prev = current
            continue
        ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
        start = current
        prev = current
    ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
    return ",".join(ranges)


def _course_sort_key(course: dict[str, Any]) -> tuple[int, int, str, str]:
    day_index = course.get("day_index") if isinstance(course.get("day_index"), int) else 99
    try:
        time_code_num = int(course.get("time_code", "9999"))
    except ValueError:
        time_code_num = 9999
    return (
        day_index,
        time_code_num,
        str(course.get("name", "")),
        str(course.get("group", "")),
    )


def _course_in_week(course: dict[str, Any], week_num: int) -> bool:
    weeks = course.get("weeks")
    return isinstance(weeks, list) and week_num in weeks


def _merge_group_courses(courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}

    for course in courses:
        name = str(course.get("name") or "")
        day_index = int(course.get("day_index") or 0)
        time_code = str(course.get("time_code") or "")
        period = str(course.get("period") or "")
        group = _extract_group_label(str(course.get("group") or ""))
        teacher = str(course.get("teacher") or "").strip()
        location = str(course.get("location") or "").strip()

        is_pe = _is_pe_course(name)
        is_experiment = _is_experiment_course(name)

        if is_pe:
            key = (day_index, time_code, period, "大学体育6", "PE")
        elif is_experiment:
            # Experimental groups should keep separate entries.
            key = (day_index, time_code, period, name, "LAB", group, location, teacher)
        else:
            key = (day_index, time_code, period, name, "NORMAL")

        if key not in merged:
            item = dict(course)
            item["group"] = group
            item["_teachers"] = {teacher} if teacher else set()
            item["_locations"] = {location} if location else set()
            item["_groups"] = {group} if group else set()
            item["_weeks"] = set(course.get("weeks") or [])
            item["_is_pe"] = is_pe
            item["_is_experiment"] = is_experiment
            merged[key] = item
            continue

        item = merged[key]
        if teacher:
            item["_teachers"].add(teacher)
        if location:
            item["_locations"].add(location)
        if group:
            item["_groups"].add(group)
        item["_weeks"].update(course.get("weeks") or [])

    result: list[dict[str, Any]] = []
    for item in merged.values():
        teachers = {value for value in item.pop("_teachers", set()) if value}
        locations = {value for value in item.pop("_locations", set()) if value}
        groups = {value for value in item.pop("_groups", set()) if value}
        weeks = sorted(item.pop("_weeks", set()))
        is_pe = bool(item.pop("_is_pe", False))
        is_experiment = bool(item.pop("_is_experiment", False))

        if is_pe:
            item["name"] = "大学体育6"
            item["teacher"] = ""
            item["location"] = ""
            item["group"] = ""
            item["group_count"] = max(1, len(groups))
        else:
            if len(teachers) == 1:
                item["teacher"] = next(iter(teachers))
            elif len(teachers) > 1:
                item["teacher"] = "多位教师"

            if len(locations) == 1:
                item["location"] = next(iter(locations))
            elif len(locations) > 1:
                item["location"] = "多个地点"

            if groups:
                item["group"] = next(iter(sorted(groups))) if len(groups) == 1 else "多个分组"
                item["group_count"] = len(groups)
            else:
                item["group"] = ""
                item["group_count"] = 1

            if is_experiment and item["group"] == "多个分组":
                item["group"] = ""

        item["weeks"] = weeks
        result.append(item)

    return sorted(result, key=_course_sort_key)


def _is_experiment_course(name: str) -> bool:
    return "[实验学时]" in name


def _is_pe_course(name: str) -> bool:
    return "大学体育6" in name


def _extract_group_label(group: str) -> str:
    if not group:
        return ""
    match = re.search(r"(分组\s*\d+)", group)
    if match:
        return match.group(1).replace(" ", "")
    return group.strip()


def _is_iso_date(text: str) -> bool:
    try:
        datetime.strptime(text, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _time_code_to_period(time_code: str) -> str:
    if len(time_code) == 4 and time_code.isdigit():
        return f"第{int(time_code[:2])}-{int(time_code[2:])}节"
    return ""
