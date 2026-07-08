# Obsidian 自研插件合集

中文 | [English](README.en.md)

这个仓库是我的 Obsidian Vault 的公开版本，只发布我自己维护的插件和最小公开配置。

它不是完整的学习笔记仓库，也不包含我的私人备考资料。

## 包含内容

### Codexidian

路径：`.obsidian/plugins/codexidian/`

在 Obsidian 侧边栏中使用 Codex 的插件，支持多会话、上下文注入、工具调用展示、计划卡片、会话持久化和基础的 Vault MCP 能力。

### Kaoyan Countdown

路径：`.obsidian/plugins/kaoyan-countdown/`

面向考研复习的倒计时与专注插件，包含考试倒计时、每日计划视图、阶段进度、番茄钟、科学专注计时和简单统计。

### Bookmarked PDF Export

路径：`.obsidian/plugins/outline-markdown-export/`

把 Obsidian Markdown 导出为带原生书签的 PDF。插件会根据 Markdown 标题生成 PDF 大纲，方便在阅读器里直接跳转章节。

## 不包含内容

这个公开仓库有意排除了以下内容：

- 个人笔记、每日计划、错题、复盘和真实学习记录
- AI agent 提示词、私有自动化、缓存、会话日志和运行时数据
- 我本地安装但并非自己维护的第三方插件
- 插件内的 `node_modules/`、嵌套 `.git/`、生成文件和导出产物

明确不进入公开仓的路径示例：

- `Daily Notes/`
- `考研数学/`、`考研英语/`、`考研计划/`
- `.agent/`、`.agents/`、`.claude/`、`.codex/`、`.learning/`
- `.obsidian/plugins/claudian/`
- `.obsidian/plugins/obsidian-local-rest-api/`

## 仓库结构

```text
.obsidian/
  app.json
  appearance.json
  community-plugins.json
  core-plugins.json
  daily-notes.json
  templates.json
  plugins/
    codexidian/
    kaoyan-countdown/
    outline-markdown-export/
LICENSE
OPEN_SOURCE_PRIVATE_LAYOUT.md
README.md
README.en.md
```

## 开发方式

每个插件都保留自己的 `package.json` 和构建脚本。进入对应插件目录后安装依赖并构建：

```bash
cd .obsidian/plugins/codexidian
npm install
npm run build
```

`kaoyan-countdown` 和 `outline-markdown-export` 使用同样方式：

```bash
cd .obsidian/plugins/kaoyan-countdown
npm install
npm run build
```

```bash
cd .obsidian/plugins/outline-markdown-export
npm install
npm run build
```

## 公开边界

公开仓只作为可复用插件与配置的发布面。完整的私人 Vault、学习笔记和日常计划保留在私有仓库中。

更多边界说明见 [OPEN_SOURCE_PRIVATE_LAYOUT.md](OPEN_SOURCE_PRIVATE_LAYOUT.md)。

## 许可证

见 [LICENSE](LICENSE)。
