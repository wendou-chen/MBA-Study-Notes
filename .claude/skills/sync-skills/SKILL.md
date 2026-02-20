---
name: sync-skills
description: 三向同步 .agent/skills、.claude/skills 和 .codex/skills 中的 SKILL.md 文件。每当对任意一侧的 skill 进行新增或修改时，必须自动同步到其余两侧，确保 Antigravity、Claude Code 和 Codex 使用完全相同的规则。当用户说「同步 skill」「skill 双向同步」或者在修改任何 skill 文件后，触发此流程。
---

# Skill 三向同步

本 vault 同时使用三套 AI 工具：
- **Antigravity**：读取 `.agent/skills/` 下的 SKILL.md
- **Claude Code**：读取 `.claude/skills/` 下的 SKILL.md
- **Codex**：读取 `.codex/skills/` 下的 SKILL.md

三个目录结构完全镜像，必须保持内容同步。

---

## 📋 目录映射关系

| Antigravity（主） | Claude Code（镜像） | Codex（镜像） |
|---|---|---|
| `.agent/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` | `.codex/skills/<name>/SKILL.md` |

根目录：`d:\a考研\Obsidian Vault\`

---

## 🔄 同步规则

### 规则 1：修改任意一侧，必须同步其余两侧

每当对某个 skill 进行**新增**或**修改**操作后：

1. 确定被修改的 skill 名称（例如 `math-problem-solver`）
2. 读取修改后的完整内容
3. 将**完全相同的内容**写入其余两侧对应路径
4. 向用户确认：「✅ 已同步到 `.agent/skills/`、`.claude/skills/` 和 `.codex/skills/`」

### 规则 2：新建 skill 时，三侧同时创建

新建 skill 时，**不能只建一侧**。必须：
1. 在 `.agent/skills/<name>/SKILL.md` 写入内容
2. 同时在 `.claude/skills/<name>/SKILL.md` 写入**相同内容**
3. 同时在 `.codex/skills/<name>/SKILL.md` 写入**相同内容**

### 规则 3：删除时同步删除（需用户确认）

若需要删除某个 skill，删除前先询问用户是否三侧都删除。

---

## ⚡ 执行流程

每次修改 skill 文件后，立即执行同步：

```
1. 读取源文件内容
   source = .agent/skills/<name>/SKILL.md  (或 .claude/... 或 .codex/...)

2. 写入目标文件（覆盖）
   target1 = .claude/skills/<name>/SKILL.md
   target2 = .codex/skills/<name>/SKILL.md
   (根据源文件位置，写入其余两侧)

3. 告知用户同步结果
   ✅ [skill名称] 已三向同步
      - .agent/skills/<name>/SKILL.md
      - .claude/skills/<name>/SKILL.md
      - .codex/skills/<name>/SKILL.md
```

---

## 📁 当前已有 Skills 清单

以下 skills 三侧均应存在，内容一致：

- `arxiv-daily-digest`
- `codex-runner`
- `command-to-skill-adapter`
- `douyin-publisher`
- `error-review-scheduler`
- `error-template-scaffold`
- `github-weekly-report`
- `json-canvas`
- `kaoyan-daily-plan`
- `kaoyan-learn-extractor`
- `math-problem-solver`
- `obsidian-bases`
- `obsidian-markdown`
- `study-notes-image-organization`
- `sync-skills`（本文件）
- `weekly-review`

---

## ⚠️ 注意事项

- `.agent/skills/` 视为**主副本**（Antigravity 修改时以此为准）
- `.claude/skills/` 视为**镜像副本**
- `.codex/skills/` 视为**镜像副本**
- 若多侧内容不一致，以**最近修改的那一侧**为准，覆盖其余两侧
- 同步时使用**完全覆盖**（write_to_file with Overwrite=true），不做 diff 合并
