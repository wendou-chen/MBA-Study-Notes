"""抖音图文发布助手 — 扫描素材、生成文案、归档已发布内容。"""

import os
import sys
import shutil
from datetime import datetime
from pathlib import Path

import anthropic

VAULT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
MATERIALS_DIR = VAULT_ROOT / "抖音素材"
PENDING_DIR = MATERIALS_DIR / "待发布"
PUBLISHED_DIR = MATERIALS_DIR / "已发布"
PUBLISH_LOG = MATERIALS_DIR / "发布记录.md"
PLAN_DIR = VAULT_ROOT / "考研计划"
DEFAULT_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
MODEL = "claude-sonnet-4-5-20250929"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

HASHTAGS = "#考研 #考研数学 #备考日常 #考研日记 #2027考研 #考研倒计时"

DAILY_NOTE_TEMPLATE = """\
---
date: {date}
type: douyin-draft
status: 待发布
style: ""
tags:
  - 抖音
  - 素材
---

# 📱 {short_date} 抖音图文素材


## 📸 图片素材

> [!info] 在下方空白处粘贴图片（Ctrl+V）
> 抖音图文上限 **9 张**，建议 3–6 张。图片会自动保存到 `images/` 子目录。






## ✏️ 文案草稿

> [!tip] 在下方空白处写下你想表达的内容
> 关键词、情绪、灵感片段都行，AI 会帮你润色成完整文案。






## 🏷️ 标签备选

#考研 #27考研 #备考日常 #考研日记 #考研数学


## 📋 发布检查

- [ ] 图片已粘贴（≤ 9 张）
- [ ] 文案草稿已填写
- [ ] 风格已选择（任务汇报 / 情感润色）
- [ ] 准备发布 → 告诉 AI「发抖音」
"""

TASK_REPORT_PROMPT = """\
你是一位考研博主的文案助手。根据以下今日学习数据，生成一条抖音图文文案（300字以内）。
风格：简洁、数据驱动、真实感强，像是在跟朋友汇报今天的学习成果。

今日数据：
{data}

要求：
1. 开头用 "Day {day_count}" 格式
2. 列出核心数据（学习时长、题量、完成率）
3. 用一两句话总结今天的感受或收获
4. 不要加标签（标签会自动追加）
"""

EMOTIONAL_PROMPT = """\
你是一位考研博主的文案助手。请对以下用户手写的文案草稿进行润色，使其更适合抖音图文发布。

风格：真实、有温度、不矫情，像是深夜发的朋友圈。保留用户原始情感，优化表达节奏。

用户草稿：
{draft}

素材描述：
{image_desc}

要求：
1. 控制在 300 字以内
2. 保留用户的核心情感和关键信息
3. 适当加入节奏感（短句、换行）
4. 不要加标签（标签会自动追加）
"""


def ensure_daily_note(date_str: str | None = None) -> Path:
    """创建今日素材日期文件夹和模板笔记，返回笔记路径。"""
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    folder = PENDING_DIR / date_str
    note_path = folder / f"{date_str}.md"
    if not note_path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "images").mkdir(exist_ok=True)
        # short_date: "2.24" 格式用于标题
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        short_date = f"{dt.month}.{dt.day}"
        note_path.write_text(
            DAILY_NOTE_TEMPLATE.format(date=date_str, short_date=short_date),
            encoding="utf-8",
        )
        print(f"已创建素材笔记：{note_path}")
    return note_path


def _extract_draft(note_path: Path) -> str | None:
    """从素材笔记的"文案草稿"部分提取用户草稿。"""
    if not note_path.exists():
        return None
    text = note_path.read_text(encoding="utf-8")
    marker = "## ✏️ 文案草稿"
    idx = text.find(marker)
    if idx == -1:
        # 兼容旧模板
        marker = "## 文案草稿"
        idx = text.find(marker)
    if idx == -1:
        return None
    draft_section = text[idx + len(marker):].strip()
    # 去掉模板占位提示行
    lines = [
        line for line in draft_section.splitlines()
        if line.strip() and not line.strip().startswith("> 可选")
    ]
    draft = "\n".join(lines).strip()
    return draft if draft else None


def load_env():
    """从 .env 文件加载环境变量。"""
    env_path = VAULT_ROOT / ".env"
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


def scan_materials(date_str: str | None = None) -> tuple[list[Path], str | None]:
    """扫描待发布素材，返回 (图片列表, 文案草稿或None)。"""
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    folder = PENDING_DIR / date_str
    if not folder.exists():
        return [], None

    images_dir = folder / "images"
    if images_dir.is_dir():
        images = sorted(
            p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS
        )
    else:
        images = sorted(
            p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS
        )

    note_path = folder / f"{date_str}.md"
    draft = _extract_draft(note_path)
    return images, draft


def read_planner_data(date_str: str | None = None) -> dict:
    """读取当日计划日志的 frontmatter 数据。"""
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    for md in PLAN_DIR.glob(f"{date_str}*"):
        text = md.read_text(encoding="utf-8")
        if text.startswith("---"):
            end = text.index("---", 3)
            frontmatter = text[3:end].strip()
            data = {}
            for line in frontmatter.split("\n"):
                if ":" in line:
                    k, v = line.split(":", 1)
                    data[k.strip()] = v.strip()
            return data
    return {}


def generate_caption(client: anthropic.Anthropic, style: str,
                     planner_data: dict, draft: str | None = None,
                     image_desc: str = "") -> str:
    """调用 Claude API 生成文案。"""
    if style == "report":
        prompt = TASK_REPORT_PROMPT.format(
            data="\n".join(f"- {k}: {v}" for k, v in planner_data.items()),
            day_count=planner_data.get("phase", "?"),
        )
    else:
        prompt = EMOTIONAL_PROMPT.format(
            draft=draft or "（用户未提供草稿，请根据素材描述生成）",
            image_desc=image_desc or "学习桌面、笔记本、错题整理",
        )

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
    except Exception as e:
        return f"⚠️ 文案生成失败：{e}"


def archive_materials(date_str: str | None = None):
    """将素材从待发布移至已发布。"""
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    src = PENDING_DIR / date_str
    dst = PUBLISHED_DIR / date_str
    if src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        print(f"已归档：{src} → {dst}")


def log_publish(date_str: str, caption: str, image_count: int,
                style: str, tags: str):
    """追加发布记录。"""
    PUBLISH_LOG.parent.mkdir(parents=True, exist_ok=True)
    entry = f"""
## {date_str}
- 图片数：{image_count}
- 文案风格：{style}
- 标签：{tags}
- 文案摘要：{caption[:80]}...

---
"""
    with open(PUBLISH_LOG, "a", encoding="utf-8") as f:
        f.write(entry)
    print(f"发布记录已追加到 {PUBLISH_LOG}")


def main():
    load_env()
    today = datetime.now().strftime("%Y-%m-%d")

    ensure_daily_note(today)

    images, draft = scan_materials(today)
    if not images:
        print(f"未找到今日素材（{PENDING_DIR / today}），请先添加图片。")
        return

    print(f"找到 {len(images)} 张图片" + ("，含文案草稿" if draft else ""))

    planner_data = read_planner_data(today)
    if planner_data:
        print(f"已读取今日计划数据：{list(planner_data.keys())}")

    ai_client = anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url=os.environ.get("ANTHROPIC_BASE_URL", DEFAULT_BASE_URL),
    )

    style = "emotional" if draft else "report"
    caption = generate_caption(ai_client, style, planner_data, draft)
    full_caption = f"{caption}\n\n{HASHTAGS}"

    print(f"\n--- 生成文案 ({style}) ---")
    print(full_caption)
    print(f"\n图片顺序：")
    for i, img in enumerate(images, 1):
        print(f"  {i}. {img.name}")

    print("\n[浏览器上传和发布确认由 Chrome DevTools MCP 处理]")


if __name__ == "__main__":
    main()
