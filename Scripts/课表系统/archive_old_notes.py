from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path

DEFAULT_VAULT_PATH = Path("/mnt/d/a考研/Obsidian Vault")
DEFAULT_DAILY_DIR = "Daily Notes"
NOTE_NAME_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")


def detect_daily_dir(vault_path: Path) -> str:
    config_path = vault_path / ".obsidian" / "daily-notes.json"
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                folder = str(data.get("folder", "")).strip()
                if folder:
                    return folder
        except (OSError, json.JSONDecodeError):
            pass
    return DEFAULT_DAILY_DIR


def _parse_note_date(file_name: str) -> date | None:
    stem = file_name.rsplit(".", 1)[0]
    try:
        return datetime.strptime(stem, "%Y-%m-%d").date()
    except ValueError:
        return None


def _iter_candidate_notes(daily_root: Path) -> list[Path]:
    candidates: list[Path] = []
    if not daily_root.exists():
        return candidates

    for note_path in daily_root.rglob("*.md"):
        rel = note_path.relative_to(daily_root)
        if rel.parts and rel.parts[0] == "Archive":
            continue
        if not NOTE_NAME_PATTERN.match(note_path.name):
            continue
        if _parse_note_date(note_path.name) is None:
            continue
        candidates.append(note_path)
    return sorted(candidates)


def archive_old_notes(
    vault_path: Path,
    daily_dir: str,
    days: int = 30,
    dry_run: bool = False,
    auto: bool = False,
    today: date | None = None,
) -> list[tuple[Path, Path]]:
    if not vault_path.exists():
        raise FileNotFoundError(f"vault path does not exist: {vault_path}")
    if days < 1:
        raise ValueError("--days must be >= 1")

    reference = today or date.today()
    cutoff = reference - timedelta(days=days)
    daily_root = (
        vault_path if daily_dir.strip() in {"", ".", "/"} else vault_path / daily_dir.strip()
    )
    archive_root = daily_root / "Archive"
    candidates = _iter_candidate_notes(daily_root)

    to_archive: list[tuple[Path, Path]] = []
    for src in candidates:
        note_day = _parse_note_date(src.name)
        if note_day is None or note_day > cutoff:
            continue
        dst_dir = archive_root / f"{note_day.year:04d}-{note_day.month:02d}"
        dst = dst_dir / src.name
        to_archive.append((src, dst))

    if not to_archive:
        print("No notes to archive.")
        return []

    print(f"Archive threshold date: {cutoff.isoformat()} (older than {days} days)")
    print(f"Found {len(to_archive)} notes to archive.")
    for src, dst in to_archive:
        print(f"- {src} -> {dst}")

    if dry_run:
        print("Dry-run mode: no files moved.")
        return to_archive

    if not auto:
        answer = input("Proceed with archive move? [y/N]: ").strip().lower()
        if answer not in {"y", "yes"}:
            print("Canceled.")
            return []

    moved: list[tuple[Path, Path]] = []
    for src, dst in to_archive:
        if not src.exists():
            print(f"Skip missing source: {src}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            # Keep existing archive note; append suffix for conflict.
            ts = datetime.now().strftime("%H%M%S")
            dst = dst.with_name(f"{dst.stem}_{ts}{dst.suffix}")
        shutil.move(str(src), str(dst))
        moved.append((src, dst))

    print(f"Archived {len(moved)} notes.")
    return moved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Archive old Obsidian Daily Notes.")
    parser.add_argument("--vault-path", default=str(DEFAULT_VAULT_PATH), help="Obsidian vault path.")
    parser.add_argument(
        "--daily-dir",
        default="",
        help="Daily Notes folder (default: read from .obsidian/daily-notes.json).",
    )
    parser.add_argument("--days", type=int, default=30, help="Archive notes older than N days.")
    parser.add_argument("--dry-run", action="store_true", help="Preview only.")
    parser.add_argument("--auto", action="store_true", help="Auto mode without confirmation.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    vault_path = Path(args.vault_path)
    daily_dir = args.daily_dir or detect_daily_dir(vault_path)
    archive_old_notes(
        vault_path=vault_path,
        daily_dir=daily_dir,
        days=args.days,
        dry_run=args.dry_run,
        auto=args.auto,
    )


if __name__ == "__main__":
    main()
