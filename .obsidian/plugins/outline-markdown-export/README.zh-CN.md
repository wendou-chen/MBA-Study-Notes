# Bookmarked PDF Export

[English](README.md) | 简体中文

把 Obsidian 笔记导出为带原生 PDF 书签的大纲化文档，书签会根据 Markdown 标题自动生成。

这个插件会把笔记里的标题层级写入 PDF 的原生 outline/bookmarks 结构。导出后，用常见 PDF 阅读器打开文件时，可以直接在侧边栏看到可点击的大纲。它也保留了原本的大纲工作流：可以复制当前笔记大纲，或把大纲导出为 Markdown 文件。

## 主要用途

这个插件主要服务两个场景：

- 整理考研大纲和考研资料。长篇 Markdown 笔记可以导出成类似书籍的 PDF，章节标题会变成可点击的 PDF 书签，复习、检索和分发资料时更顺手。
- 配合我的笔记仓库 [MBA Study Notes](https://github.com/wendou-chen/MBA-Study-Notes) 使用。笔记仓库负责沉淀 Obsidian 里的结构化知识，这个插件负责把选中的笔记、大纲和专题资料包导出成带书签的 PDF。

这两个仓库配合使用会更有效：`MBA Study Notes` 负责长期维护知识库结构，`Bookmarked PDF Export` 负责把 Markdown 标题结构转换成可阅读、可分享、可归档的 PDF 文档。

## 功能

- 将当前笔记导出为 `*.bookmarked.pdf`。
- 为 Obsidian 原生导出的 PDF 添加书签。
- 根据 Markdown 标题生成 PDF 书签。
- 导出的 PDF 会写入 `/Outlines`，并设置 `/PageMode /UseOutlines`。
- 复制或导出当前笔记的 Markdown 大纲。

## 命令

| 命令 | 作用 |
| --- | --- |
| 复制当前文件大纲 Markdown | 将当前笔记的标题树复制到剪贴板。 |
| 导出当前文件大纲 Markdown | 在源笔记旁边生成 `*.outline.md` 文件。 |
| 导出带书签 PDF | 将当前笔记导出为 `*.bookmarked.pdf`，并注入原生 PDF 书签。 |
| 为原生导出的 PDF 添加书签 | 查找匹配的 PDF，并根据源 Markdown 标题添加书签。 |

PDF 相关命令依赖 Electron 的 PDF 导出能力，因此需要在 Obsidian 桌面端使用。

## 为什么需要这个插件

Obsidian 自带 PDF 导出，社区里也有不少插件可以改善导出样式或处理长文发布。但对考研资料、课程讲义、手册式文档来说，一个常见缺口是：PDF 里没有可靠的原生书签。

这个插件专注解决这个小而关键的问题：继续用 Markdown 写笔记，导出 PDF 时保留标题结构，让 PDF 也像一本有目录的书一样可导航。

## 插件定位

| 工具或方案 | PDF 导出 | 原生 PDF 书签 | 说明 |
| --- | --- | --- | --- |
| Bookmarked PDF Export (`outline-markdown-export`) | 支持 | 支持 | 使用 `pdf-lib` 写入 `/Outlines`，并设置 `/PageMode /UseOutlines`。 |
| Obsidian 原生 PDF 导出 | 支持 | 不能可靠按 Markdown 标题生成 | 可以作为“为原生导出的 PDF 添加书签”命令的来源 PDF。 |
| 常见 outline/TOC 插件 | 通常不负责 | 通常不负责 | 多数用于生成 Markdown 目录或笔记内导航，不写 PDF outline 对象。 |

## 从源码安装

```bash
npm install
npm run build
```

然后把下面这些文件放在你的 vault 插件目录中，或直接保留当前插件目录：

```text
.obsidian/plugins/outline-markdown-export/
  main.js
  manifest.json
```

之后在 Obsidian 的社区插件设置中启用插件。

## 开发

```bash
npm install
npm run dev
npm test
```

测试覆盖大纲解析、导出路径、标题过滤、页码匹配和 PDF 书签注入。

## 限制

- PDF 导出命令需要 Obsidian 桌面端。
- 书签来自 Markdown 标题。
- 为已有 PDF 添加书签时，需要根据 PDF 页面文本匹配标题；扫描版或纯图片 PDF 可能匹配效果不好。
- 默认 PDF 书签只选取较高层级标题，避免导出的 PDF 大纲过深。

## GitHub 仓库信息

推荐 GitHub description：

> Export Obsidian notes to PDFs with native bookmarks generated from Markdown headings.

推荐 topics：

```text
obsidian-plugin, obsidian, markdown, pdf, bookmarks, outline, typescript
```

## 许可证

MIT
