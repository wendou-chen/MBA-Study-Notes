"""ArXiv 论文日报 — 每日抓取前沿论文并生成中文摘要，写入 Obsidian 笔记。"""

import os
import sys
from datetime import datetime
from pathlib import Path

import anthropic
import arxiv

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent  # vault root
OUTPUT_DIR = SCRIPT_DIR / "论文日报"
DEFAULT_BASE_URL = "https://api.anthropic.com"
MODEL = "claude-sonnet-4-5-20250929"

QUERY = (
    'ti:"UAV Trajectory Optimization"'
    ' OR ti:"ISAC" OR ti:"Integrated Sensing and Communication"'
    ' OR ti:"Reconfigurable Intelligent Surface" OR ti:"RIS"'
    ' OR ti:"Semantic Communication"'
)

SUMMARY_PROMPT = """\
你是一位无线通信领域的研究助手。请用中文总结以下论文摘要，重点关注：
1. **核心贡献**：这篇论文解决了什么问题？提出了什么新方法？
2. **数学模型**：用了哪些关键的数学工具/优化框架？
3. **关键结论**：主要实验/仿真结果如何？

请用 Markdown 格式输出，简洁专业。

论文标题：{title}
摘要原文：
{abstract}"""


def load_env():
    """从 .env 文件加载环境变量（复用 start_obsidian.py 逻辑）。"""
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


def fetch_papers(max_results: int = 5) -> list:
    """从 ArXiv 搜索最新论文。"""
    client = arxiv.Client()
    search = arxiv.Search(
        query=QUERY,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate,
    )
    return list(client.results(search))


def summarize(client: anthropic.Anthropic, title: str, abstract: str) -> str:
    """调用 Claude API 生成中文摘要。"""
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": SUMMARY_PROMPT.format(title=title, abstract=abstract),
            }],
        )
        return resp.content[0].text
    except Exception as e:
        return f"⚠️ 摘要生成失败：{e}"


def format_entry(idx: int, paper, summary: str) -> str:
    """格式化单篇论文为 Obsidian Markdown。"""
    arxiv_id = paper.entry_id.split("/abs/")[-1]
    authors = ", ".join(a.name for a in paper.authors[:5])
    if len(paper.authors) > 5:
        authors += " et al."
    published = paper.published.strftime("%Y-%m-%d")
    categories = " ".join(f"`{c}`" for c in paper.categories)

    # 将摘要每行加 > 前缀以适配 callout
    summary_lines = "\n".join(f"> {line}" for line in summary.split("\n"))

    return f"""## {idx}. {paper.title}

| 字段 | 信息 |
|------|------|
| 链接 | [arXiv:{arxiv_id}]({paper.entry_id}) |
| 作者 | {authors} |
| 日期 | {published} |
| 分类 | {categories} |

> [!abstract] AI 摘要
{summary_lines}

---
"""


def write_daily_file(entries: list[str], paper_count: int):
    """写入当日论文日报文件。已存在则追加。"""
    OUTPUT_DIR.mkdir(exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    filepath = OUTPUT_DIR / f"{today}.md"

    if filepath.exists():
        # 追加模式：加一个分隔标记
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(f"\n\n---\n\n# 追加运行 {datetime.now().strftime('%H:%M')}\n\n")
            f.write("\n".join(entries))
        print(f"已追加到 {filepath}")
    else:
        # 新建文件：写入 frontmatter + 概览 + 论文
        frontmatter = f"""---
date: {today}
tags:
  - research-log
  - arxiv
  - UAV
  - ISAC
  - RIS
  - semantic-comm
paper_count: {paper_count}
---

# 论文日报 {today}

> [!info] 今日概览
> 共检索到 **{paper_count}** 篇相关论文，涵盖 UAV 轨迹优化、ISAC、RIS、语义通信方向。

---

"""
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter)
            f.write("\n".join(entries))
        print(f"已创建 {filepath}")


def main():
    load_env()

    print("正在搜索 ArXiv 最新论文...")
    papers = fetch_papers()

    if not papers:
        print("今日无新论文。")
        # 仍然创建文件记录
        write_daily_file(["> [!warning] 今日无新论文\n> 未检索到匹配的最新论文。\n"], 0)
        return

    print(f"找到 {len(papers)} 篇论文，正在生成摘要...")
    ai_client = anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url=os.environ.get("ANTHROPIC_BASE_URL", DEFAULT_BASE_URL),
    )

    entries = []
    for i, paper in enumerate(papers, 1):
        print(f"  [{i}/{len(papers)}] {paper.title[:60]}...")
        summary = summarize(ai_client, paper.title, paper.summary)
        entries.append(format_entry(i, paper, summary))

    write_daily_file(entries, len(papers))
    print("完成！")


if __name__ == "__main__":
    main()
