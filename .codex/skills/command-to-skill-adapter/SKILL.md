---
name: command-to-skill-adapter
description: 将任意通用 command 文件（.md 指令文件）改写为项目定制版，并通过 skill-creator 生成可被系统识别的正式 skill。当用户说"把这个 command 改成 skill"、"把这个指令文件适配到当前项目"、"这个模板需要项目定制化"时触发。
---

# Command → 项目定制 Skill 改写器

将通用 command 文件改写为深度适配当前项目的正式 skill，必须先充分理解项目上下文，再进行改写。

## 核心问题：为什么需要这个 Skill？

通用 command 文件（如 `/learn`）的常见缺陷：
- 提取类别是通用领域，不适合当前项目
- **直接写入单文件**，缺少 YAML frontmatter
- 系统无法将其识别为正式 skill，只是普通笔记

正确做法：**先读懂项目，再通过 skill-creator 生成**带 YAML frontmatter 的标准目录结构。

---

## Phase 0：学习项目上下文（必须先做）

在任何改写之前，必须充分了解当前项目是什么、目标是什么，否则改写的 skill 仍然是通用的，没有实际价值。

### 0.1 读取项目定义文件

按优先级读取以下文件（存在即读）：

```
CLAUDE.md / README.md        # 项目整体说明、规范、背景
.claude/settings.json         # 项目级 AI 配置
.agent/settings.json          # Antigravity 配置
```

### 0.2 读取现有 Skills（了解已有覆盖范围）

```
.agent/skills/*/SKILL.md     # 每个 skill 的 description 行
.claude/skills/*/SKILL.md
```

目的：
- 理解项目已经在用哪些 skill
- 避免创建重复的 skill
- 了解项目的 skill 命名和描述风格

### 0.3 读取 Command 文件本身

完整读取需要改写的 command `.md` 文件。

### 0.4 提炼项目画像

基于以上阅读，回答以下问题后再进行后续步骤：

| 问题 | 示例答案（考研项目）|
|------|------------------|
| 项目是什么？ | Obsidian 考研备考知识库 |
| 核心用户行为是什么？ | 刷题、整理错题、写每日计划 |
| 项目的主要领域有哪些？ | 数学/英语/专业课/计划管理 |
| 已有哪些 skill 覆盖了什么？ | `kaoyan-daily-plan`、`error-review-scheduler` 等 |
| 这个 command 的目的是什么？ | 提取当次会话中的可复用学习模式 |
| 改写后 skill 的触发场景是什么？ | 解完一类数学题、整理完一章错题后 |

---

## Phase 1：读取并分析原 Command

识别原 command 的结构：
- 触发条件
- 提取/分析的类别（通常 3-5 个类别）
- 过滤规则
- 输出格式（写到哪里、什么格式）

---

## Phase 2：改写为项目定制版

### 2.1 替换提取类别

基于 Phase 0 的项目画像，将通用类别逐项替换为项目领域的具体类别。

每个类别应包含：
- 类别名称（反映项目领域）
- 3-5 个具体的判断问题

**示例**（通用开发 → 考研备考）：

| 原通用类别 | 替换为项目定制类别 |
|-----------|----------------|
| Error Resolution Patterns | 易错知识点（根本原因/正确理解/高频度）|
| Debugging Techniques | 解题方法与技巧（通用思路/边界条件）|
| Workarounds | 知识点关联（跨章节联系/概念辨析）|
| Project-Specific Patterns | 笔记整理模式（Obsidian 结构/错题分类）|

### 2.2 设计过滤规则

添加不提取的明确规则，针对项目领域定制：
- 排除项目中的单次偶发问题
- 排除已有 skill 已覆盖的内容
- 排除过于基础的内容

### 2.3 向用户展示改写结果

展示改写后的内容，等待用户确认后进入 Phase 3。

---

## Phase 3：调用 skill-creator 创建正式 Skill（核心，所有项目通用）

将改写内容通过 skill-creator 正式部署：

1. 确定 Skill 名称（kebab-case，反映项目领域，如 `kaoyan-learn-extractor`）
2. 确定触发描述（一句话，说明何时激活，基于项目画像）
3. 调用 `/skill-creator`，传入整理的内容
4. 确认生成的目录结构：
   ```
   .claude/skills/[skill-name]/
   ├── SKILL.md          # 包含 YAML frontmatter
   └── references/       # 可选
   ```
5. 确认 SKILL.md 包含正确的 YAML frontmatter：
   ```yaml
   ---
   name: skill-name
   description: 针对[项目领域]的一句话触发条件描述
   ---
   ```

> **重要**：不要直接写入 `learned/` 目录。必须通过 skill-creator 创建带 YAML frontmatter 的正式 SKILL.md，否则系统无法识别。

---

## Phase 4：确认并同步

- 向用户展示创建的 skill 路径和内容摘要
- 如果项目同时使用 `.agent/` 和 `.claude/`，将 skill 同步到两个位置
- 建议将原 command 文件保留（作为参考）或删除（如已完全被 skill 覆盖）

---

## 质量检查清单

- [ ] Phase 0 已完成：读取了 README/CLAUDE.md 和现有 skills
- [ ] 提取类别已替换为符合**当前项目画像**的具体内容
- [ ] 有明确的过滤规则（针对项目领域）
- [ ] 输出通过 skill-creator，**不是直接写文件**
- [ ] SKILL.md 包含 YAML frontmatter（name + description）
- [ ] description 反映了项目领域和触发场景
- [ ] 有两阶段用户确认（Phase 2 展示 + Phase 4 确认）
- [ ] 如需要，已同步到 `.agent/` 和 `.claude/` 两个位置
