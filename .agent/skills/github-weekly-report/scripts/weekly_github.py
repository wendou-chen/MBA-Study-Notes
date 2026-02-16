"""GitHub 周热榜 — 每周抓取热门项目并生成中文摘要，写入 Obsidian 笔记。"""

import os
import sys
import time
import base64
from datetime import datetime, timedelta
from pathlib import Path

import anthropic
import requests

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent  # vault root
OUTPUT_DIR = SCRIPT_DIR / "GitHub周刊"
DEFAULT_BASE_URL = "https://yunyi.cfd/claude"
MODEL = "claude-sonnet-4-5-20250929"
GITHUB_API = "https://api.github.com"

# 查询分类配置
CATEGORIES = [
    {
        "name": "🔥 全局热榜",
        "query_extra": "",
        "min_stars": 100,
        "count": 5,
        "deep_summary": True,
    },
    {
        "name": "🤖 AI / 机器学习",
        "query_extra": "topic:machine-learning OR topic:deep-learning OR topic:llm",
        "min_stars": 30,
        "count": 5,
        "deep_summary": False,
    },
    {
        "name": "📡 信号处理 / 通信",
        "query_extra": "topic:signal-processing OR topic:communications OR topic:wireless OR language:matlab",
        "min_stars": 5,
        "count": 2,
        "deep_summary": False,
    },
    {
        "name": "🐍 Python 工具",
        "query_extra": "language:python",
        "min_stars": 50,
        "count": 3,
        "deep_summary": False,
    },
]

SUMMARY_PROMPT = """\
你是一位技术趋势分析师。请用中文为以下 GitHub 项目写一段简介（3-5 句），重点关注：
1. **项目定位**：解决什么问题？面向什么用户？
2. **技术亮点**：核心技术栈或创新点
3. **考研学生视角**：对通信/电子方向研究生有什么参考价值？

请用 Markdown 格式输出，简洁专业。

项目：{full_name}
描述：{description}
语言：{language}
README 片段：
{readme}"""

TRANSLATE_PROMPT = """\
将以下 GitHub 项目描述翻译为简洁的中文（一句话）。如果已经是中文则原样返回。

描述：{description}"""


def load_env():
    """从 .env 文件加载环境变量（复用 daily_paper.py 逻辑）。"""
    env_path = SCRIPT_DIR / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())

    if "ANTHROPIC_API_KEY" not in os.environ:
        print("错误：未找到 ANTHROPIC_API_KEY，请在 .env 中配置。", file=sys.stderr)
        sys.exit(1)

    if "GITHUB_TOKEN" not in os.environ:
        print("提示：未配置 GITHUB_TOKEN，将以匿名模式访问 GitHub API（限速 10 次/分钟）。")


def _github_headers() -> dict:
    """构建 GitHub API 请求头。"""
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"token {token}"
    return headers


def fetch_trending(query_extra: str, min_stars: int, count: int,
                   since_date: str) -> list[dict]:
    """通过 GitHub Search API 获取热门仓库。"""
    q = f"created:>{since_date} stars:>={min_stars}"
    if query_extra:
        q += f" {query_extra}"

    url = f"{GITHUB_API}/search/repositories"
    params = {"q": q, "sort": "stars", "order": "desc", "per_page": count}

    try:
        resp = requests.get(url, headers=_github_headers(), params=params, timeout=15)
        if resp.status_code == 403:
            print(f"  ⚠️ GitHub API 限速，跳过此分类。")
            return []
        if resp.status_code == 422:
            print(f"  ⚠️ GitHub API 查询无效（422），跳过此分类。")
            return []
        resp.raise_for_status()
        return resp.json().get("items", [])
    except requests.RequestException as e:
        print(f"  ⚠️ GitHub API 请求失败：{e}")
        return []


def fetch_readme_snippet(full_name: str, max_chars: int = 500) -> str:
    """获取仓库 README 前 N 个字符（用于全局热榜深度摘要）。"""
    url = f"{GITHUB_API}/repos/{full_name}/readme"
    try:
        resp = requests.get(url, headers=_github_headers(), timeout=10)
        if resp.status_code != 200:
            return ""
        content = resp.json().get("content", "")
        decoded = base64.b64decode(content).decode("utf-8", errors="replace")
        return decoded[:max_chars]
    except Exception:
        return ""


def summarize(client: anthropic.Anthropic, repo: dict, readme: str) -> str:
    """调用 Claude API 生成深度中文摘要（全局热榜用）。"""
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": SUMMARY_PROMPT.format(
                    full_name=repo["full_name"],
                    description=repo.get("description") or "无描述",
                    language=repo.get("language") or "未知",
                    readme=readme or "（无 README）",
                ),
            }],
        )
        return resp.content[0].text
    except Exception as e:
        return f"⚠️ 摘要生成失败：{e}"


def translate_description(client: anthropic.Anthropic, description: str) -> str:
    """调用 Claude API 将描述翻译为中文（轻量翻译）。"""
    if not description:
        return "无描述"
    # 简单检测：如果已含大量中文字符则跳过翻译
    cn_chars = sum(1 for c in description if "\u4e00" <= c <= "\u9fff")
    if cn_chars > len(description) * 0.3:
        return description
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=128,
            messages=[{
                "role": "user",
                "content": TRANSLATE_PROMPT.format(description=description),
            }],
        )
        return resp.content[0].text.strip()
    except Exception:
        return description


def format_table_row(idx: int, repo: dict, desc_cn: str) -> str:
    """格式化单个仓库为表格行。"""
    stars = f"{repo['stargazers_count']:,}"
    lang = repo.get("language") or "—"
    name = repo["full_name"]
    url = repo["html_url"]
    return f"| {idx} | [{name}]({url}) | {stars} | {lang} | {desc_cn} |"


def format_summary_callout(repo: dict, summary: str) -> str:
    """格式化 AI 深度摘要为 Obsidian callout。"""
    summary_lines = "\n".join(f"> {line}" for line in summary.split("\n"))
    return f"""\n> [!tip] AI 简介：{repo['full_name']}
{summary_lines}
"""


def format_section(category_name: str, repos: list[dict],
                   descriptions: list[str],
                   summaries: list[str] | None = None) -> str:
    """格式化完整分类段落。"""
    desc_col = "描述" if summaries else "中文描述"
    lines = [
        f"## {category_name}",
        "",
        f"| # | 项目 | ⭐ Stars | 语言 | {desc_col} |",
        "|---|------|---------|------|------|",
    ]
    for i, (repo, desc) in enumerate(zip(repos, descriptions), 1):
        lines.append(format_table_row(i, repo, desc))

    if summaries:
        lines.append("")
        for repo, summary in zip(repos, summaries):
            lines.append(format_summary_callout(repo, summary))

    lines.append("\n---\n")
    return "\n".join(lines)


def write_weekly_file(sections: list[str], week_start: str, week_end: str,
                      repo_count: int):
    """写入周刊文件。已存在则跳过。"""
    OUTPUT_DIR.mkdir(exist_ok=True)
    filepath = OUTPUT_DIR / f"{week_start}~{week_end}.md"

    if filepath.exists():
        print(f"本周周刊已存在，跳过写入：{filepath}")
        return

    frontmatter = f"""---
date: {week_end}
tags: [github-weekly, tech-trends]
week_range: {week_start} ~ {week_end}
repo_count: {repo_count}
---

# GitHub 周热榜 {week_start} ~ {week_end}

> [!info] 本周概览
> 共收录 **{repo_count}** 个热门项目，覆盖全局热榜、AI/ML、信号处理/通信、Python 工具四个方向。

---

"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter)
        f.write("\n".join(sections))
    print(f"已创建 {filepath}")


def main():
    load_env()

    today = datetime.now()
    # 计算本周一到今天的日期范围
    week_start = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    week_end = today.strftime("%Y-%m-%d")
    since_date = week_start

    # 检查文件是否已存在
    OUTPUT_DIR.mkdir(exist_ok=True)
    filepath = OUTPUT_DIR / f"{week_start}~{week_end}.md"
    if filepath.exists():
        print(f"本周周刊已存在，跳过：{filepath}")
        return

    print(f"GitHub 周热榜 {week_start} ~ {week_end}")
    print("=" * 50)

    ai_client = anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url=os.environ.get("ANTHROPIC_BASE_URL", DEFAULT_BASE_URL),
    )

    seen: set[str] = set()
    sections: list[str] = []
    total_count = 0

    for cat in CATEGORIES:
        print(f"\n正在获取：{cat['name']}...")
        repos = fetch_trending(cat["query_extra"], cat["min_stars"],
                               cat["count"] + 5, since_date)
        # 去重并截取
        unique_repos = []
        for repo in repos:
            if repo["full_name"] not in seen:
                seen.add(repo["full_name"])
                unique_repos.append(repo)
            if len(unique_repos) >= cat["count"]:
                break

        if not unique_repos:
            print(f"  无结果，跳过。")
            continue

        print(f"  找到 {len(unique_repos)} 个项目，正在处理...")
        descriptions = []
        summaries = [] if cat["deep_summary"] else None

        for i, repo in enumerate(unique_repos, 1):
            desc = repo.get("description") or ""
            print(f"  [{i}/{len(unique_repos)}] {repo['full_name']}")

            if cat["deep_summary"]:
                readme = fetch_readme_snippet(repo["full_name"])
                summary = summarize(ai_client, repo, readme)
                summaries.append(summary)
                descriptions.append(desc[:80] if desc else "无描述")
                time.sleep(0.5)  # 避免 API 限速
            else:
                desc_cn = translate_description(ai_client, desc)
                descriptions.append(desc_cn)
                time.sleep(0.3)

        sections.append(format_section(cat["name"], unique_repos,
                                       descriptions, summaries))
        total_count += len(unique_repos)

    if not sections:
        print("所有分类均无结果。")
        return

    write_weekly_file(sections, week_start, week_end, total_count)
    print(f"\n完成！共收录 {total_count} 个项目。")


if __name__ == "__main__":
    main()
