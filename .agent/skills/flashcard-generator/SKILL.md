---
name: flashcard-generator
description: 自动闪卡生成器。从固定解法速查表和高频错题中提取卡片，使用 Obsidian callout 折叠做翻卡，简单盒子 SRS 调度。当用户说"/闪卡"、"今日闪卡"、"复习卡片"时触发。
---

# 自动闪卡生成器 Skill

## 触发词

- `/闪卡`
- `今日闪卡`
- `复习卡片`

## 工作流

1. 读取 `.scripts/flashcard_state.json`，加载卡片 SRS 状态。
2. 读取 `考研数学/固定解法速查表.md`，按每个 H3 下 callout 解析：
   - 卡片 ID：`固定解法-{H3标题}`
   - 正面：`**触发**` 字段
   - 背面：`**做法**` + `**公式**`
   - 来源：`[[固定解法速查表#{H3标题}]]`
3. 读取 `考研数学/错题/*/*.md`，提取错误次数 `>= 2` 条目：
   - 卡片 ID：`错题-{章节}-{知识点}`
   - 正面：错误知识点 + 错误原因
   - 背面：正确做法提示
4. 选择今日卡片：
   - 新卡：state 中不存在的卡片，每天最多 5 张
   - 复习卡：state 中 `next_review <= today`
5. 若昨天闪卡文件存在，解析自评复选框并更新 state：
   - `🟢 秒答`：box + 1
   - `🟡 想了一会`：box 不变
   - `🔴 不会`：box = 0
   - 盒子间隔：`[1, 3, 7, 14, 30, 60]`（天）
6. 生成 `考研数学/每日闪卡/YYYY-MM-DD 闪卡.md`。

## 输出格式

### 文件 frontmatter

```yaml
---
date: YYYY-MM-DD
type: flashcard-session
cards_total: N
cards_new: N
cards_review: N
tags: [闪卡, 数学]
---
```

### 卡片模板

```markdown
### 卡片 N · 章节 · 🆕/🔄

> [!question] 正面内容（触发条件或知识点）

> [!success]- 答案（点击展开）
> 背面内容（做法、公式）
> 📋 来源：[[链接]]

自评：- [ ] 🟢 秒答 - [ ] 🟡 想了一会 - [ ] 🔴 不会
```
