---
name: douyin-publisher
description: 自动化抖音图文发布流程。适用于用户说"发抖音"、"发布"、"publish douyin"时触发。扫描素材文件夹，调用 Claude API 生成文案，通过 Puppeteer MCP 连接浏览器上传到抖音创作者平台，仅在最终发布步骤请求用户确认。
---

# 抖音图文发布流程

自动化的端到端发布流程：素材扫描 → 内容排序 → 文案生成 → 浏览器上传 → 用户确认 → 归档。

## 前置条件

- `.env` 中配置 `ANTHROPIC_API_KEY`（文案生成）
- 浏览器操作工具（按优先级）：
  1. **Puppeteer MCP**（推荐）— 需要 `puppeteer_connect_active_tab` 或直连 `9222`，支持 `uploadFile` 穿透上传限制。
  2. Chrome DevTools MCP（备选）
  3. Antigravity browser_subagent（**避免使用**：在 iframe 本地图片上传和系统弹窗中受限，无法填入中文图片路径）
- **Cookie 持久化**（重要）：使用专用浏览器启动脚本，避免每次重新登录
  ```powershell
  # 首次使用 — 运行启动脚本（支持 -Chrome 参数，对 Puppeteer MCP 更友好）
  .agent\skills\douyin-publisher\scripts\launch_douyin_browser.ps1 -Chrome
  # 也可以直接用默认 Edge / 开发测试
  .agent\skills\douyin-publisher\scripts\launch_douyin_browser.bat
  ```
  - 脚本会以 `--user-data-dir` 参数启动 Chrome/Edge，Cookie 保存到 `chrome-profile/douyin-session/`
  - 首次需手动登录 `creator.douyin.com`，之后 session 自动持久化（通常数周有效）
  - 配合 `--remote-debugging-port=9222`，自动化工具可直接连接
- 素材笔记由脚本自动创建（`ensure_daily_note()`），无需手动建文件夹

| 工具 | 优势 | 劣势 |
|------|------|------|
| **Puppeteer MCP**（推荐） | 支持通过 `elementHandle.uploadFile()` 等极高权限底层接口直接往隐藏的 `<input type="file">` 中填入绝对路径，**能完美突破跨域 iframe 和系统级对话框阻断**。 | 需要保持并连接 9222 端口，初次调用需确认 DOM 结构。 |
| Chrome DevTools MCP | 同样通过 CDP 协议支持文件注入，拥有完整 a11y 树。 | 需要在节点操作前 `take_snapshot`，响应稍慢。 |
| Antigravity browser_subagent | 原生集成，视觉定位找按钮非常智能。 | **严重受限**：基于 Playwright 的底层纯键盘键鼠模拟映射，如果强行向受保护或弹窗注入中文字符（路径中含『考研』等）会立即由于键盘映射缺失报错崩溃，无法突破文件上传框。 |

**全面拥抱 Puppeteer MCP 进行自动化发布流程**。发布动作前先确认已通过启动脚本（优先配 `-Chrome`）打开带 9222 调试端口的持久化浏览器。

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

### Step 4: 浏览器上传

> **工具优先级**：Puppeteer MCP > Chrome DevTools MCP
> 使用持久化浏览器脚本启动 Chrome，Cookie/登录状态保存在 `chrome-profile/douyin-session/` 目录。
> 🚨 核心逻辑：Puppeteer MCP 能够通过 CDP 底层协议使用 `uploadFile` 之类的高权限 API 直接向 file_input 发送文件字节，必须利用这一特性实现全自动，而绝不应该用鼠标瞎点弹出的系统“打开文件”对话框。

**4.0 确保持久化浏览器已启动**
```powershell
# 必须附加 9222 端口开启调试，推荐带 -Chrome
.agent\skills\douyin-publisher\scripts\launch_douyin_browser.ps1 -Chrome
```

**4.1 连接浏览器并导航**
```
mcp_puppeteer_puppeteer_connect_active_tab → 连接
mcp_puppeteer_puppeteer_navigate url="https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web"
```

**4.2 检查登录状态**
```
mcp_puppeteer_puppeteer_screenshot → 检测是否进入图文后台
```
如看到二维码/登录页 → 提醒用户手动扫码（由于有持久化会话，通常只在数周内扫一次）；完成后继续。

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

| 脚本 | 功能 |
|------|------|
| `scripts/douyin_publish.py` | 素材扫描、文案生成、归档等非交互操作 |
| `scripts/launch_douyin_browser.ps1` | 启动持久化 Chrome/Edge 浏览器（默认 Edge，可通过 `-Chrome` 切换） |
| `scripts/launch_douyin_browser.bat` | 批处理简易版启动（默认启动 Edge 版） |

浏览器操作**核心强制要求**：优先且尽可能只使用 **Puppeteer MCP**（`puppeteer_connect_active_tab` 或 直连 WebSocket），以确保能够用 `elementHandle.uploadFile()` 方法直接传送照片并穿透文件上传框。
**避免使用**基于视觉/模拟输入的普通浏览器 Agent，因为他们会被系统的选中文件对话框阻断，并触发含有中文字符时的 `Unknown key` 映射崩溃。

### Cookie 持久化机制
- 配置目录：`chrome-profile/douyin-session/`（自动创建，已加入 .gitignore）
- 启动参数：`--user-data-dir` + `--remote-debugging-port=9222`
- 首次登录后 Cookie 自动保存，后续启动免登录
- Session 通常有效数周，过期后需重新扫码一次

## 踩坑记录

### innerHTML 写标签无效（2026-02-20）
- **现象**：用 `editor.innerHTML = '...#考研...'` 写入的标签只是普通文字，不被平台识别为话题
- **原因**：抖音编辑器的话题标签是特殊 DOM 节点（带 data 属性），只有通过话题搜索弹窗点选才能创建
- **解决**：文案和标签分开处理。先粘贴纯文案，再用 `insertText` + 点选弹窗逐个添加话题

### Playwright / UI-Automation 本地文件上传陷阱（2026-02-23）
- **现象**：尝试使用 Antigravity browser_subagent 代替 Puppeteer 时遇到无法上传本地图片的问题。
- **原因**：
  1. 上传组件在跨域 iframe 里，限制了 DOM 选择。
  2. 点击上传后跳出系统的 File Picker，超越了浏览器内 DOM 控制域。
  3. UI 键位映射失效：当工具试图在系统框或受控 input 暴力强制打字时，因为带着诸如 `"考研"` 这样的中文字符的绝对路径，触发了 `Unknown key: "考"` 崩溃。
- **解决**：统一回归到 Puppeteer MCP 规范，使用纯粹的 CDP 级别 API（`uploadFile`）往底层 input 句柄注入文件流。

### 标签命名热度优先（2026-02-20）
- `#27考研`（6.0亿热度）>> `#2027考研`（热度极低）
- 平台话题搜索会自动匹配缩写，优先选择高热度版本
