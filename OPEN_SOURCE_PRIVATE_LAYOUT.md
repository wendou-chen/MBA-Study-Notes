---
tags:
  - open-source
  - repository
  - governance
---

# Public / Private 仓库边界说明

## 仓库角色

### Public 仓（当前仓库）

定位：对外模板仓。

保留内容：

- `Claudian`、`Codexidian`、`Kaoyan Countdown` 等可公开分发的插件包
- `考研数学/解题板.md` 与相关公开模板
- `考研计划/示例计划.md`、`Templates/考研每日计划模板.md`
- `community/` 中与学习流程相关的最小公开脚本
- 公开文档、配置样例、许可证

### Private 仓（你的日常主仓）

定位：唯一主仓。

建议放入：

- 真实笔记、真实计划、周复盘
- `.agent/`、`.agents/`、`.claude/`、`.codex/` 等私有技能/提示词/编排目录
- 个人自动化脚本、会话记录、实验性流程
- 个人题库、课程资料、非学习类工作流

## 默认规则

> [!warning]
> 任何涉及个人计划、真实学习记录、私有技能、密钥、个人路径的内容，默认只留在 private 仓。

- private 是唯一主仓
- public 只接收脱敏后的模板化内容
- public 发布粒度固定为：插件更新、题板模板更新、公开学习自动化更新、示例配置/文档更新

## 建立 private 主仓（手动）

本次自动创建 private GitHub 仓库被权限策略拦截，因此改为提供手动步骤。

### 方案 A：保留当前历史（推荐）

1. 在 GitHub 创建一个新的 private 仓库，例如 `MBA-Study-Notes-private`
2. 在本地当前仓库执行：

```bash
git remote rename origin public
git remote add private git@github.com:<your-account>/MBA-Study-Notes-private.git
git push private main
```

3. 之后把私有内容继续提交到 private，把 public 当作模板发布仓维护

### 方案 B：重新初始化 private 仓

如果你更希望 private 仓从干净历史开始：

```bash
mkdir ../MBA-Study-Notes-private
robocopy "." "..\MBA-Study-Notes-private" /E /XD .git .tmp node_modules logs
cd ../MBA-Study-Notes-private
git init
git add .
git commit -m "chore: bootstrap private main repo"
git remote add origin git@github.com:<your-account>/MBA-Study-Notes-private.git
git push -u origin main
```

## 提交前检查

```bash
git status --short
git check-ignore -v .agents .agent .claude .codex Daily\ Notes Excalidraw Scripts copilot
git ls-files | rg "^(\.agents|Daily Notes|Excalidraw|Scripts|copilot|大唐杯题库|课程|论文日报)"
```

如果最后一条命令仍有输出，说明 public 仓里还有私有/非模板内容未清干净。

