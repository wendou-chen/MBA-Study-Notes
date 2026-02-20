---
name: douyin-publisher
description: 自动化抖音图文发布流程。适用于用户说"发抖音"、"发布"、"publish douyin"时触发。扫描素材文件夹，调用 Claude API 生成文案，通过 Puppeteer MCP 连接浏览器上传到抖音创作者平台，仅在最终发布步骤请求用户确认。
---

# 抖音图文发布流程

自动化的端到端发布流程：素材扫描 → 内容排序 → 文案生成 → 浏览器上传 → 用户确认 → 归档。

## 前置条件

- `.env` 中配置 `ANTHROPIC_API_KEY`（文案生成）
- Puppeteer MCP 已配置（浏览器自动化，优先）或 Chrome DevTools MCP（备选）
- 用户需以远程调试模式启动 Chrome：
  ```bash
  # Windows — 建议创建桌面快捷方式
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
  ```
- 首次使用时在该 Chrome 中手动登录 `creator.douyin.com`，之后 session 自动持久化（通常数周有效）
- 素材笔记由脚本自动创建（`ensure_daily_note()`），无需手动建文件夹

## MCP 工具选择

| MCP | 优势 | 劣势 |
|-----|------|------|
| **Puppeteer MCP**（推荐） | CSS 选择器直接操作，速度快，无需 snapshot 往返 | 需要 puppeteer_connect_active_tab 连接 |
| Chrome DevTools MCP | 完整 a11y 树，精确元素定位 | 每次操作需 take_snapshot，往返慢 |

优先使用 Puppeteer MCP。如果 Puppeteer 不可用，回退到 Chrome DevTools MCP。

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
根据内容匹配标签组：#考研 #考研数学 #备考日常 #考研日记 #27考研

> ⚠️ **标签命名规则**：使用平台高热度缩写，如 `#27考研`（6.0亿）而非 `#2027考研`（热度低）。发布前可在话题搜索中确认热度。

### Step 4: 浏览器上传（Puppeteer MCP 优先）

> **工具优先级**：Puppeteer MCP > Chrome DevTools MCP
> 两者都通过 `--remote-debugging-port=9222` 连接用户真实 Chrome，Cookie/登录状态由 Chrome 原生管理。
> Puppeteer 使用 CSS 选择器直接操作，无需 snapshot 往返，速度显著更快。

**4.1 连接浏览器并导航**
```
puppeteer_connect_active_tab → 连接 Chrome
puppeteer_navigate url="https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web"
```

**4.2 检查登录状态**
```
puppeteer_screenshot → 检查是否已登录
```
如看到二维码/登录页 → 提示用户扫码（一次性，session 持久化数周）

**4.3 选择图文模式**
点击"发布图文"标签切换到图文上传：
```
puppeteer_click selector="包含'发布图文'文字的标签元素"
```

**4.4 上传图片**
找到文件输入元素，按排序顺序逐张上传：
```
puppeteer_click selector="上传按钮/文件输入"
```
- 第一张通过上传区域的文件输入上传
- 后续通过"继续添加"按钮上传
- 每张上传后等待确认（检查"已添加N张图片"文字）

**4.5 填写标题**
```
puppeteer_fill selector="input[placeholder*='标题']" value="标题文字"
```

**4.6 填写描述（纯文案，不含标签）**

> ⚠️ **关键经验**：抖音描述框是 `contenteditable` 富文本编辑器。
> - **禁止**用 `innerHTML` 写入标签文字（如 `#考研`），平台不会识别为话题标签
> - **正确做法**：先用剪贴板粘贴纯文案，再通过平台话题机制逐个添加标签

```javascript
// Step 1: 清空编辑器并粘贴纯文案（不含 # 标签）
puppeteer_evaluate: () => {
  const editor = document.querySelector('[contenteditable="true"]');
  editor.focus();
  const text = `文案第一段\n\n文案第二段\n\n文案第三段`;
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  editor.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt, bubbles: true, cancelable: true
  }));
}
```

**4.7 添加话题标签（必须通过平台机制）**

> ⚠️ **核心规则**：标签必须通过在编辑器中输入 `#关键词` 触发平台话题搜索弹窗，然后点击选中对应话题。
> 只有这样添加的标签才会被平台识别为蓝色可点击话题，获得话题流量。
> 用 innerHTML 或纯文本写入的 `#xxx` 只是普通文字，不会被识别。

逐个添加标签的流程：
```
1. 光标移到编辑器末尾
2. 输入换行 + `#考研` → 等待话题搜索弹窗
3. 点击弹窗中的 "#考研" 选项 → 标签变蓝
4. 输入空格 + `#备考日常` → 点击选中
5. 重复直到所有标签添加完毕
```

使用 `document.execCommand('insertText', false, '#标签名')` 模拟键盘输入触发话题搜索。

**4.8 预览确认**
```
puppeteer_screenshot → 截图预览，展示给用户确认
```

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
浏览器操作优先通过 Puppeteer MCP（`puppeteer_connect_active_tab` 连接用户 Chrome），备选 Chrome DevTools MCP。

## 踩坑记录

### innerHTML 写标签无效（2026-02-20）
- **现象**：用 `editor.innerHTML = '...#考研...'` 写入的标签只是普通文字，不被平台识别为话题
- **原因**：抖音编辑器的话题标签是特殊 DOM 节点（带 data 属性），只有通过话题搜索弹窗点选才能创建
- **解决**：文案和标签分开处理。先粘贴纯文案，再用 `insertText` + 点选弹窗逐个添加话题

### 标签命名热度优先（2026-02-20）
- `#27考研`（6.0亿热度）>> `#2027考研`（热度极低）
- 平台话题搜索会自动匹配缩写，优先选择高热度版本
