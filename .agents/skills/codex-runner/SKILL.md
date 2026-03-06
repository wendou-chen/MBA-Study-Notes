---
name: codex-runner
description: 直接驱动 Codex CLI 执行任务，无需用户手动复制计划。当用户说「交给 codex」「让 codex 执行」「/codex」时触发。Antigravity 组织 prompt 后通过 run_command 启动 codex，自动监控执行进度并汇报结果。
---

# Codex Runner Skill

Antigravity 直接驱动 Codex CLI，省去手动复制计划的步骤。

## 工作流

### Phase 1：构建 Prompt

将需要执行的任务浓缩为**一段结构化文字**，格式如下：

```
按照以下要求修改代码：

【背景】
<1~2句说明当前状态>

【任务】
1. <具体操作1，包含文件路径>
2. <具体操作2>
...

【参考文件】
- <相关文件路径>（用途说明）

【验证】
<怎样算完成>
```

**要求**：
- prompt 必须是**自包含**的，codex 不会看到我们的对话上下文
- 文件路径使用相对于项目根目录（`d:\a考研\Obsidian Vault`）的路径
- 任务描述要**具体**，避免模糊词（如「优化」「改进」）

---

### Phase 2：启动 Codex

> ✅ **正确命令**：`codex exec "<prompt>"` —— 非交互模式，**不需要 TTY**，可直接在 `run_command` 中使用。
>
> ❌ 不要用 `codex -a never "<prompt>"`：这是 TUI 模式，需要真实终端，在 `run_command` 里会报 `stdin is not a terminal`。
>
> ❌ 不要用 `Start-Process` 开新窗口：无法监控输出，无法读取结果。

#### 2.1 先将 Prompt 写入计划文件

用 `write_to_file` 将 Phase 1 的 Prompt 写到：
```
d:\a考研\Obsidian Vault\.agent\codex-current-plan.md
```

#### 2.2 用 `run_command` 执行 Codex

```powershell
$plan = Get-Content '.agent\codex-current-plan.md' -Raw; codex exec $plan
```

`run_command` 参数：
- `Cwd`：设为 `d:\a考研\Obsidian Vault`
- `SafeToAutoRun`：设为 `false`（Codex 会修改文件，需用户确认）
- `WaitMsBeforeAsync`：设为 `15000`（等 15 秒，Codex 启动需要时间）
- 然后用 `command_status` 持续轮询，直到 `Status: DONE`

> 💡 **关于上下文保持**：`codex exec` 是一次性任务模式，每次调用都是独立会话，没有跨调用的上下文记忆。
> 如果需要持续对话，需要在新开的终端中用交互模式 `codex`（用户手动操作）。

---

### Phase 3：监控进度

每隔 **20 秒** 调用 `command_status` 检查输出：

```
CommandId: <来自 Phase 2 的 ID>
WaitDurationSeconds: 20
OutputCharacterCount: 2000
```

**完成判断**（检测以下关键词）：
- 成功：`Done`、`✓`、`Wrote`、`Edited`、`Created`
- 失败：`Error`、`failed`、`Cannot`、`permission denied`
- 等待确认（`-a full` 下不应出现，但若出现）：`[y/n]`、`Approve?`

**最多轮询 10 次**（约 3 分钟），超时则通知用户手动检查。

---

### Phase 4：汇报结果

读取 codex 输出，提取：
- 修改了哪些文件（`Edited`、`Wrote`、`Created` 后面的路径）
- 执行是否成功
- 如有报错，摘录错误信息

向用户简要汇报，格式：

```
✅ Codex 执行完成

修改文件：
- `.obsidian/plugins/error-collector/main.js`（+9 行/-10 行）

结果：两处 bug 均已修复，存量记录已清理。
```

---

## 注意事项

- **`--approval-policy never` 的风险**：codex 会自动执行所有文件变更和 shell 命令，无二次确认。确保 prompt 描述准确再启动。
- **长任务**：若任务预计超过 5 分钟，在 prompt 中告知 codex「请分步完成，每步完成后输出一行进度」。
- **引号转义**：prompt 中如果含有单引号 `'`，在 PowerShell 命令中需改为双引号或转义。
- **失败重试**：如果 codex 报错，读取错误信息后修改 prompt 重新启动，不要反复重试相同 prompt。

---

## 示例

**用户说**：「让 codex 执行修复计划」

**Antigravity 组织的 prompt**：

```
按照以下要求修改文件：

【背景】
.obsidian/plugins/error-collector/main.js 存在两处 bug：
1. extractSection() 遇到 ## 标题不停止，导致答案 callout 包含多余内容
2. buildErrorRecord() 输出格式与现有错题记录不一致

【任务】
1. 修改 extractSection() 方法（约第112-126行）：
   将 if (/^\*\*.+\*\*$/.test(trimmed)) 改为同时检测 ## 标题和 --- 分割线
2. 修改 buildErrorRecord() 方法（约第209-231行）：
   输出格式改为 ![[images/图片]] + 四行 - **字段**: 值 + 答案callout，去掉日期标题

【参考文件】
- 考研数学/错题/微分方程/微分方程错题.md（前80行为现有格式参考）

【验证】
修改后 buildErrorRecord() 生成的内容第一行应为 ![[images/...]]，无 ## 标题行
```

**执行命令**：
```powershell
codex --approval-policy never "按照以下要求修改文件：..."
# 简写等价：
codex -a never "按照以下要求修改文件：..."
```
