# 考研 Obsidian Public Template

这是一个面向 **Obsidian + AI 学习工作流** 的公开模板仓。

它的目标不是公开我的全部个人备考资料，而是提供一套可以直接克隆到本地、稍作首配后即可使用的公开模板，包括：

- `Claudian`：Claude 侧边栏协作插件
- `Codexidian`：Codex 侧边栏协作插件
- `Kaoyan Countdown`：考研倒计时 / 每日计划 / 专注计时插件
- `考研数学/解题板.md`：可直接用于粘贴题目截图和整理解答的题板模板
- `考研计划/示例计划.md`：供 `Kaoyan Countdown` 直接读取的示例计划
- `community/`：可选的公开学习流程脚本

## 这是什么

这个仓库现在被收敛为 **public 模板仓**：

- 面向粉丝 / 同学：拿来就能搭起自己的考研 Vault
- 面向开发者：可以直接查看和修改插件源码
- 面向 AI 工作流：保留公开、安全、可复用的学习流程

## 不包含什么

这个 public 仓 **不包含** 以下内容：

- 我的真实每日计划、周复盘、会话记录
- 私有技能目录、提示词编排、个人自动化策略
- 非学习类流程（例如抖音发布）
- 个人题库、课程资料、私人笔记
- 真实 API key、个人路径、私有环境配置

仓库边界与 private 主仓说明见：[`OPEN_SOURCE_PRIVATE_LAYOUT.md`](OPEN_SOURCE_PRIVATE_LAYOUT.md)

## 仓库包含的核心内容

### 1. 核心插件

- `.obsidian/plugins/claudian/`
- `.obsidian/plugins/codexidian/`
- `.obsidian/plugins/kaoyan-countdown/`
- `.obsidian/plugins/obsidian-local-rest-api/`

这些插件包已经随仓库一起提交，fresh clone 后不需要再逐个下载。

### 2. 模板与示例

- `考研数学/解题板.md`
- `考研计划/示例计划.md`
- `Templates/考研每日计划模板.md`

### 3. 可选扩展

- `community/scripts/auto_daily_plan_min.py`
- `community/scripts/paper_digest_min.py`

`community/` 只是可选扩展，不是主入口。

## 3 分钟上手

### 第 1 步：克隆仓库并打开 Vault

```bash
git clone https://github.com/wendou-chen/MBA-Study-Notes.git
```

用 Obsidian 打开仓库根目录。

### 第 2 步：关闭 Restricted Mode

本仓库已提交最小社区插件启用配置 `.obsidian/community-plugins.json`。

关闭 Obsidian 的 `Restricted mode` 后，以下插件应可直接启用：

- `Claudian`
- `Codexidian`
- `Kaoyan Countdown`
- `Obsidian Local REST API`

如果 Obsidian 没有自动启用，请到 `Settings -> Community plugins` 手动打开它们。

### 第 3 步：先看两个入口文件

- 数学题板：[`考研数学/解题板.md`](考研数学/解题板.md)
- 计划示例：[`考研计划/示例计划.md`](考研计划/示例计划.md)

`Kaoyan Countdown` 在没有找到“今日计划文件”时，会优先显示 `示例计划.md`，方便 fresh clone 后直接看到效果。

## 首次配置

### Claudian

用途：在 Obsidian 里直接使用 Claude 工作流。

前置要求：

- 已安装 Claude CLI，或已准备好插件支持的认证方式
- 如果你走环境变量模式，可在插件设置中填写：
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_BASE_URL`（可选）
  - `ANTHROPIC_MODEL`（可选）

建议：先保证 Claude CLI 或认证本身能在系统里正常工作，再回到 Obsidian 使用插件。

### Codexidian

用途：在 Obsidian 里直接使用 Codex CLI / app-server。

前置要求：

- 已安装 `codex` 或 `codex.cmd`
- 命令能在终端里直接执行
- 已完成一次 CLI 登录/认证（推荐先在终端执行 `codex login`）

注意：

- `Codexidian` 的主认证方式是 **CLI 登录**，不是在 Vault 里直接填 raw API key
- 插件里的 `MCP API key` 只用于你的 MCP / Obsidian 接口，不是 Codex 模型密钥

### MCP / start_obsidian.py

用途：给 AI 提供 Vault 读写能力。

前置要求：

1. 在 Obsidian 中启用 `Obsidian Local REST API`
2. 复制 `.env.example` 为 `.env`
3. 填入：

```bash
OBSIDIAN_API_KEY=你的 Local REST API Key
```

4. 安装 Python 依赖：

```bash
pip install mcp-obsidian
```

5. 启动：

```bash
python start_obsidian.py
```

## 每日计划 / 倒计时链路

`Kaoyan Countdown` 默认读取 `考研计划/` 目录。

推荐工作流：

1. 先看 [`考研计划/示例计划.md`](考研计划/示例计划.md)
2. 复制一份，命名为今天的日期，例如：
   - `2026-03-06.md`
   - `2026-03-06 周五.md`
3. 按以下格式写任务：

```markdown
- [ ] 08:00-10:00 | 数学 | 高数例题 3 题
```

也可以使用模板：[`Templates/考研每日计划模板.md`](Templates/考研每日计划模板.md)

## 解题板用法

打开 [`考研数学/解题板.md`](考研数学/解题板.md)，把题目截图粘进去即可。

仓库默认将附件目录设为 `考研数学/images`，这样题目图片会和解题板放在一起，迁移和同步都更方便。

## 可选扩展：community

`community/` 里只保留公开、安全、偏学习流程的最小脚本，例如：

```bash
python community/scripts/auto_daily_plan_min.py
python community/scripts/paper_digest_min.py --max-results 5
```

如果你只想使用插件、题板和每日计划，这一部分可以完全忽略。

## 常见问题

### 1. 为什么 fresh clone 后有些高级功能没有“零配置即用”？

因为 AI 工具本身需要你完成首配，例如：

- Claude 侧需要 Claude 认证
- Codex 侧需要 Codex CLI 登录
- MCP 侧需要你自己的 Local REST API Key

这个仓库追求的是：**模板和插件拿来即能落地，AI 能力只需一次首配即可用**。

### 2. 为什么 public 仓里没有你的真实计划和私有技能？

因为这些内容已经移到 private 主仓边界中处理，不再作为 public 模板的一部分。

### 3. 这个仓库适合谁？

适合：

- 想搭建考研 Obsidian 工作流的人
- 想研究 Obsidian AI 插件的人
- 想把题板 / 计划 / 倒计时联动起来的人

## License

[MIT](LICENSE)

