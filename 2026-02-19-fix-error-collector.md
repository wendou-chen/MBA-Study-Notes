# 任务：修复 error-collector 插件的输出格式

## 文件路径

`.obsidian/plugins/error-collector/main.js`

---

## 需要修复的两个 Bug

### Bug 1：答案 callout 把 "收录到错题本" 区域也包进去了

**原因**：`extractSection()` 方法提取 `**✅ 最终答案**` 段落时，
会一直读到下一个 `**加粗标题**` 才停止，但文件末尾的 `## 📥 收录到错题本？`
是 `##` 标题格式而非 `**` 格式，所以没有被识别为终止符，导致答案内容一路读到文件末尾。

**修复**：在 `extractSection()` 方法里，将终止条件从：
```js
if (/^\*\*.+\*\*$/.test(trimmed)) {
```
改为：
```js
if (/^\*\*.+\*\*$/.test(trimmed) || /^#{1,6}\s/.test(trimmed) || trimmed === '---') {
```

即：遇到任意 Markdown 标题（`#`、`##` 等）或分割线 `---` 也停止提取。

---

### Bug 2：生成的错题记录格式与现有 80 条记录格式不一致

**现有格式**（`考研数学/错题/微分方程/微分方程错题.md` 前 80 条的格式）：

```markdown
![[images/图片文件名]]
- **错误次数**: 1
- **错误知识点**: 知识点名称
- **详细错误原因**: 错误分析...
```

**当前插件生成的格式**（错误）：

```markdown
## 题目 · 2026-02-19

![[images/图片文件名]]

**知识点**：知识点名称
**错误原因**：（待填写）
**解题关键**：...

> [!success] 答案
> ...
```

**修复目标**：将 `buildErrorRecord()` 方法的输出改为与现有格式完全对齐，
同时保留「解题关键」和「答案 callout」两个新增字段：

```markdown
![[images/图片文件名]]
- **错误次数**: 1
- **错误知识点**: 章节名（从解题板"解题思路"段首句自动填入）
- **详细错误原因**：（待填写）
- **解题关键**：解题板"解题思路"段提取的第一句话

> [!success] 答案
> $$\boxed{最终答案}$$
```

---

## 具体修改内容

### 修改 1：`extractSection()` 方法（约第 112-126 行）

将：
```js
if (/^\*\*.+\*\*$/.test(trimmed)) {
  endIndex = i;
  break;
}
```

改为：
```js
if (
  /^\*\*.+\*\*$/.test(trimmed) ||
  /^#{1,6}\s/.test(trimmed) ||
  trimmed === '---'
) {
  endIndex = i;
  break;
}
```

### 修改 2：`buildErrorRecord()` 方法（约第 209-231 行）

将整个方法改为：

```js
buildErrorRecord({ chapter, imageName, keySentence, answerText }) {
  const imageBlock = imageName ? `![[images/${imageName}]]` : '（未解析到题目图片）';
  const safeKeySentence = keySentence && keySentence.trim() ? keySentence.trim() : '（未解析到）';
  const safeAnswer = answerText && answerText.trim() ? answerText.trim() : '（未解析到）';
  const answerCallout = this.toCallout(safeAnswer);

  return [
    '',
    imageBlock,
    `- **错误次数**: 1`,
    `- **错误知识点**: ${chapter}`,
    `- **详细错误原因**：（待填写）`,
    `- **解题关键**：${safeKeySentence}`,
    '',
    answerCallout,
    '',
  ].join('\n');
}
```

---

## 修复后需要同时处理：清理已生成的错误记录

`考研数学/错题/微分方程/微分方程错题.md` 末尾已有一条格式错误的记录（第 80-99 行），
请将其替换为修复后的格式：

```markdown
![[images/Pasted image 20260219211906.png]]
- **错误次数**: 1
- **错误知识点**: 微分方程（积分方程逐次求导法）
- **详细错误原因**：（待填写）
- **解题关键**：这是一个含有 $\int_0^x (x-t)f(t)\,dt$ 形式的积分方程，对两边逐次求导转化为二阶 ODE $f'' + f = -\cos x$，属共振型。

> [!success] 答案
> $$\boxed{f(x) = \cos x - \frac{x\sin x}{2}}$$
```

同理，`考研数学/错题/一元函数积分/一元函数积分错题.md` 也有一条相同格式错误的记录，
也请按同样的格式清理（图片嵌入、知识点、关键解法相同，知识点改为「一元函数积分（积分方程）」）。

---

## 验证

修复完成后，在 Obsidian 解题板中重新勾选 checkbox 测试：
1. 生成的新记录应与现有格式一致（无 `## 题目 · 日期` 标题）
2. 答案 callout 中不再包含「收录到错题本」内容
3. 使用 `error-review-scheduler` 扫描时，**错误次数**字段能被正确识别
