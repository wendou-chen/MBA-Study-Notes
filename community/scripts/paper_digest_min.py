#!/usr/bin/env python3
"""Community minimal arXiv digest generator for Obsidian."""

from __future__ import annotations

import argparse
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
DEFAULT_QUERY = (
    'all:"UAV Trajectory Optimization" OR '
    'all:"ISAC" OR '
    'all:"Integrated Sensing and Communication" OR '
    'all:"Reconfigurable Intelligent Surface" OR '
    'all:"Semantic Communication"'
)


def fetch_arxiv_entries(query: str, max_results: int) -> list[dict[str, str]]:
    params = {
        "search_query": query,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": str(max_results),
    }
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "kaoyan-community-digest/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            xml_text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"failed to fetch arXiv API: {exc}") from exc

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise RuntimeError(f"failed to parse arXiv response: {exc}") from exc
    entries: list[dict[str, str]] = []
    for node in root.findall("atom:entry", ATOM_NS):
        title = (node.findtext("atom:title", default="", namespaces=ATOM_NS) or "").strip().replace("\n", " ")
        summary = (node.findtext("atom:summary", default="", namespaces=ATOM_NS) or "").strip()
        entry_id = (node.findtext("atom:id", default="", namespaces=ATOM_NS) or "").strip()
        published = (node.findtext("atom:published", default="", namespaces=ATOM_NS) or "")[:10]
        author_nodes = node.findall("atom:author/atom:name", ATOM_NS)
        authors = ", ".join((author.text or "").strip() for author in author_nodes[:6] if author.text)
        if len(author_nodes) > 6:
            authors += ", et al."
        category_nodes = node.findall("atom:category", ATOM_NS)
        categories = " ".join(f"`{tag.attrib.get('term', '')}`" for tag in category_nodes if tag.attrib.get("term"))

        entries.append(
            {
                "title": title,
                "summary": summary,
                "id": entry_id,
                "published": published,
                "authors": authors or "Unknown",
                "categories": categories or "`N/A`",
            }
        )
    return entries


def summary_callout(summary: str, max_chars: int = 800) -> str:
    clipped = summary[:max_chars].strip()
    if len(summary) > max_chars:
        clipped += " ..."
    wrapped = textwrap.wrap(clipped, width=90) or ["N/A"]
    return "\n".join(f"> {line}" for line in wrapped)


def render_markdown(target_date: date, entries: list[dict[str, str]], query: str) -> str:
    lines = [
        "---",
        f"date: {target_date.isoformat()}",
        "type: paper-digest",
        "source: arxiv",
        f"paper_count: {len(entries)}",
        "tags:",
        "  - paper-digest",
        "  - arxiv",
        "---",
        "",
        f"# 论文日报 {target_date.isoformat()}（社区版）",
        "",
        "> [!info] 说明",
        "> 该社区版仅做抓取与整理，不包含私有 AI 提示词与深度总结策略。",
        "",
        f"> [!note] 查询词：`{query}`",
        "",
    ]

    if not entries:
        lines.extend(
            [
                "> [!warning] 无结果",
                "> 今日未检索到匹配论文。",
                "",
            ]
        )
        return "\n".join(lines) + "\n"

    for idx, entry in enumerate(entries, start=1):
        lines.extend(
            [
                f"## {idx}. {entry['title']}",
                "",
                f"- 链接：[{entry['id']}]({entry['id']})",
                f"- 日期：{entry['published']}",
                f"- 作者：{entry['authors']}",
                f"- 分类：{entry['categories']}",
                "",
                "> [!abstract] 原始摘要（截断）",
                summary_callout(entry["summary"]),
                "",
                "---",
                "",
            ]
        )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate minimal arXiv digest note.")
    parser.add_argument("--date", default=date.today().isoformat(), help="target date, format YYYY-MM-DD")
    parser.add_argument("--query", default=DEFAULT_QUERY, help="arXiv query expression")
    parser.add_argument("--max-results", type=int, default=5, help="number of papers to fetch")
    parser.add_argument("--output-dir", default="论文日报", help="directory for output markdown")
    parser.add_argument("--force", action="store_true", help="overwrite file if exists")
    args = parser.parse_args()

    target_date = date.fromisoformat(args.date)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{target_date.isoformat()}.md"

    if output_path.exists() and not args.force:
        print(f"[SKIP] output exists: {output_path}")
        return 0

    try:
        entries = fetch_arxiv_entries(args.query, args.max_results)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}")
        return 1
    content = render_markdown(target_date, entries, args.query)
    output_path.write_text(content, encoding="utf-8")
    print(f"[OK] generated: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
