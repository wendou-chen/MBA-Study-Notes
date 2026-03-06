---
name: obsidian-plugin-duplicate-guard
description: 识别并修复 Obsidian 插件开发中的“资源已存在但记录缺失”幽灵重复问题。当用户提到 duplicate、重复资源、重复记录、资源拷贝与索引不同步时触发。
---

# obsidian-plugin-duplicate-guard

## Description

Obsidian 插件开发中"资源已存在但记录缺失"的防御模式。当插件执行"复制资源 + 写入记录"两步操作时，
如果第一步成功但第二步失败（崩溃、异常、竞态），下次重试会误判为"重复"并尝试更新不存在的记录，导致永久卡死。

## Trigger

当开发或调试 Obsidian 插件时，遇到以下模式触发：
- 插件执行"复制文件/资源 → 写入/追加记录"的两步操作
- 查重逻辑基于资源是否已存在（如图片文件是否已复制）
- 用户报告"操作无反应"或"收录失败"但无明显错误提示

## Pattern: Ghost Duplicate

```
步骤 1: copyResource()  → 成功（资源已落盘）
步骤 2: appendRecord()  → 失败（异常/崩溃/竞态）
重试时:
  copyResource() 发现资源已存在 → 判定为"重复"
  updateExistingRecord() → 找不到记录 → 抛异常
  → 永久失败循环
```

## Fix Pattern

在"重复"分支中，用 try/catch 包裹更新操作。如果更新失败（记录不存在），回退到新增记录的逻辑：

```javascript
const isDuplicate = await this.copyResourceIfNeeded(source, target);
if (isDuplicate) {
  try {
    await this.updateExistingRecord(recordFile, resourceName);
    return { isDuplicate: true };
  } catch (_e) {
    // Resource exists but record is missing — fall through to create new record
  }
}
// Append new record
await this.appendRecord(recordFile, newRecord);
```

## Checklist

- [ ] 两步操作（资源复制 + 记录写入）是否有原子性保障？
- [ ] 查重逻辑是否仅依赖资源存在性？应同时检查记录是否存在
- [ ] 更新失败时是否有 fallback 到新增？
- [ ] 是否有 `isProcessing` 锁防止 modify 事件重入？
- [ ] 失败时是否有用户可见的反馈（Notice / console.error）？

## Related

- `error-collection-workflow` — 错题收录工作流规范
- `error-template-scaffold` — 错题模板创建
