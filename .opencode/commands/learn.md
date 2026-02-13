# /learn - 提取可复用的知识与模式

分析当前会话，提取任何值得保存为技能（Skill）的模式，特别是关于笔记排版、仓库清理和错题学习的经验。

## 触发条件

在解决了一个关于排版、Git管理或学习流程的非平凡问题后运行 `/learn`。

## 提取内容

关注以下方面：

1. **排版与格式化模式 (Typesetting Patterns)**
   - 图片如何处理？（例如：自动归档到特定章节的 images 文件夹）
   - Markdown 或 Obsidian 特有的格式要求是什么？
   - Canvas 知识图谱的布局逻辑。
   - 是否有可复用的模板？

2. **仓库与文件管理 (Repository Management)**
   - 文件清理策略（如：识别并删除无用的“未命名.base”文件）
   - Git 操作的最佳实践（如：批量移动文件、特定提交信息的格式）
   - 目录结构优化的决策。

3. **学习与解题流程 (Learning Context)**
   - 错题笔记的结构（错误原因、知识点、纠错过程）
   - 上下文学习的关联方式（如何将题目与知识点相连）
   - 复习策略的自动化（如：如何提取特定错题）

4. **项目特定规范 (Project Conventions)**
   - 发现的命名规范
   - 确定的架构决策
   - 笔记间的链接模式

## 输出格式（真正的 Skill 结构）

使用 `skill-creator` 的模板创建技能目录，并填写 `SKILL.md`（必须包含 YAML 头部）：

1. 技能目录：`.opencode/skills/<skill-name>/`
2. 技能文件：`.opencode/skills/<skill-name>/SKILL.md`

`skill-name` 必须使用 hyphen-case（小写英文、数字、短横线），例如：`study-notes-image-organization`。

`SKILL.md` 模板：

```markdown
---
name: <skill-name>
description: <用一句到两句说明“做什么 + 何时使用/触发条件”，尽量把触发场景写全>
---

# <技能标题>

## 目标
用 1-2 句话说明此技能帮助你完成什么。

## 标准流程
用编号步骤写清可复用工作流（例如：排版、图片归档、仓库清理、错题整理）。

## 校验清单
列出完成后需要检查的点（避免遗漏、避免误提交）。

## 常见变体
当出现不同情况时怎么调整（可选）。
```

## 流程

1. 回顾会话，寻找可提取的模式
2. 识别最有价值/最可复用的洞察（排版、清理、学习方法）
3. 选一个合适的 `skill-name`（hyphen-case）
4. 用初始化脚本创建技能骨架：
   - `python ".opencode/skills/skill-creator/scripts/init_skill.py" <skill-name> --path ".opencode/skills"`
5. 编辑 `.opencode/skills/<skill-name>/SKILL.md`，完成 YAML 头部与流程内容
6. 运行校验：
   - `python ".opencode/skills/skill-creator/scripts/quick_validate.py" ".opencode/skills/<skill-name>"`
7. （可选）打包生成 `.skill`：
   - `python ".opencode/skills/skill-creator/scripts/package_skill.py" ".opencode/skills/<skill-name>" ".opencode/skills/dist"`
8. 保存前请求用户确认（主要确认：技能名、description 触发条件、是否需要打包）

## 注意事项

- 不要提取琐碎的修复（拼写错误、简单的语法错误）
- 不要提取一次性的问题
- 专注于能为未来的笔记整理和复习节省时间的模式
- 保持技能专注 —— 每个技能只包含一个模式
