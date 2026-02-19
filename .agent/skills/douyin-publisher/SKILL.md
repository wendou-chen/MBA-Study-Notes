---
name: douyin-publisher
description: 自动化抖音图文发布流程。适用于用户说"发抖音"、"发布"、"publish douyin"时触发。扫描素材文件夹，调用 Claude API 生成文案，通过 Chrome DevTools MCP 连接用户真实 Chrome 浏览器上传到抖音创作者平台，仅在最终发布步骤请求用户确认。
---

# 抖音图文发布流程

自动化的端到端发布流程：素材扫描 → 内容排序 → 文案生成 → 浏览器上传 → 用户确认 → 归档。

## 前置条件

- `.env` 中配置 `ANTHROPIC_API_KEY`（文案生成）
- Chrome DevTools MCP 已配置（浏览器自动化）
- 用户需以远程调试模式启动 Chrome：
  ```bash
  # Windows — 建议创建桌面快捷方式
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
  ```
- 首次使用时在该 Chrome 中手动登录 `creator.douyin.com`，之后 session 自动持久化（通常数周有效）
- 素材笔记由脚本自动创建（`ensure_daily_note()`），无需手动建文件夹

## 素材目录结构

```
抖音素材/
├── 待发布/
│   └── {YYYY-MM-DD}/
│       ├── {YYYY-MM-DD}.md     # 素材笔记（粘贴目标 + 文案草稿）
│       └── images/             # Obsidian 粘贴图片自动保存到这里
│           └── Pasted image *.png
├── 已发布/
│   └── {YYYY-MM-DD}/          # 发布后整个文件夹归档
└── 发布记录.md                 # 追加式发布日志
```

## 工作流

### Step 0: 确保今日笔记就绪
- 调用 `ensure_daily_note()` 自动创建 `待发布/{today}/{today}.md` 和 `images/` 子目录
- 如笔记已存在则跳过，幂等操作

### Step 1: 扫描素材
- 读取 `抖音素材/待发布/{today}/images/` 目录
- 识别图片文件（jpg, png, webp）
- 从 `{today}.md` 笔记的"文案草稿"部分提取用户手写文案
- 如无素材，提示用户打开笔记粘贴图片

### Step 2: 分析与排序
- 分析图片内容，确定最佳排列顺序：
  - 封面图（最有冲击力）→ 细节图（学习过程）→ 收尾图（成果/情感）
- 超过 9 张图片时建议裁剪（抖音图文上限）
- 向用户展示排序方案，可调整

### Step 3: 生成文案
- 读取当日 `考研计划/` 日志的 frontmatter 数据
- 根据用户选择的风格生成文案：

**风格 A — 任务汇报型：**
从 Planner 日志提取 math_hours, math_problems, completion_rate 等字段，生成数据驱动的进度汇报。示例：
> Day 15 | 数学 4.5h · 16题 · 完成率 85%
> 今天死磕微分方程欧拉方程，终于搞懂了 x=eᵗ 换元的本质...

**风格 B — 情感润色型：**
读取素材笔记中"文案草稿"部分的用户手写内容，结合素材内容和当日 mood 字段进行润色。保留用户原始情感，优化表达和节奏。

**标签自动追加：**
根据内容匹配标签组：#考研 #考研数学 #备考日常 #考研日记 #2027考研

### Step 4: 浏览器上传（Chrome DevTools MCP）

> 核心原理：通过 `chrome-devtools-mcp` 连接用户以 `--remote-debugging-port=9222` 启动的真实 Chrome 浏览器。
> Cookie 由 Chrome 原生管理，登录状态自然持久化，无需任何 cookie 保存/加载代码。
>
> 关键模式：**先 `take_snapshot` 获取页面元素 UID，再用 UID 调用 `click`/`fill`/`upload_file`**。
> 所有交互都基于 snapshot 返回的 UID，不使用 CSS 选择器。

**4.1 导航到上传页**
1. `list_pages` → 查看已打开的页面，如已有抖音创作者页面则 `select_page` 选中
2. 如无抖音页面 → `navigate_page` url=`https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web`
3. `wait_for` text="发布" → 等待页面加载完成

**4.2 检查登录状态**
1. `take_screenshot` → 截图检查是否已登录
2. 如看到二维码/登录页 → 提示用户在该 Chrome 窗口中扫码登录（一次性操作，之后 session 持久化数周）
3. 登录后 `navigate_page` 重新导航到上传页

**4.3 选择图文模式**
1. `take_snapshot` → 获取页面元素树和 UID
2. 在 snapshot 中找到"图文"标签页元素的 UID
3. `click` uid=图文标签的UID → 切换到图文发布模式
4. `wait_for` → 等待图文上传区域出现

**4.4 上传图片**
1. `take_snapshot` → 获取上传区域的文件输入元素 UID
2. `upload_file` uid=文件输入UID, filePath=第一张图片的绝对路径
3. 重复上传剩余图片（按 Step 2 确定的排序顺序）
4. 每张上传后短暂等待，确保上传完成

**4.5 填写描述和标签**
使用 `evaluate_script` 操作富文本编辑器（抖音使用 contenteditable div）：
```javascript
() => {
  const editor = document.querySelector('[contenteditable="true"]');
  if (!editor) return 'editor not found';
  editor.innerHTML = `文案内容<br><br>#标签1 #标签2`;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return 'done';
}
```

**4.6 预览确认**
1. `take_screenshot` → 截图预览，展示给用户确认

### Step 5: 用户确认（阻塞）
- 截取发布预览页面截图
- 向用户展示：图片顺序、文案内容、标签
- **必须等待用户明确输入 "确认" 或 "y" 后才能点击发布**
- 用户可在此步修改文案或调整图片

### Step 6: 发布与归档
- `click` → 点击发布按钮
- 等待发布成功确认
- 将素材从 `抖音素材/待发布/{today}/` 移至 `抖音素材/已发布/{today}/`
- 追加记录到 `抖音素材/发布记录.md`：
  ```markdown
  ## {date}
  - 图片数：{count}
  - 文案风格：{style}
  - 标签：{tags}
  ```

## 脚本

素材扫描、文案生成、归档等非交互操作由 `scripts/douyin_publish.py` 处理。
浏览器操作通过 Chrome DevTools MCP 工具直接调用（连接用户真实 Chrome 浏览器）。
