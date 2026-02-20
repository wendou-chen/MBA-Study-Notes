# /learn - 提取可复用学习模式并创建正式 Skill

分析当前会话上下文，提取考研学习中值得保存的知识模式，并自动调用 `skill-creator` 创建符合格式的正式 Skill。

## 触发

在会话中完成了错题整理、知识点梳理、解题方法总结后，运行 `/learn`。

## Phase 1：上下文分析

回顾当前会话，识别以下类型的可复用学习模式：

1. **易错知识点**
   - 哪个知识点容易出错？
   - 错误的根本原因是什么（概念混淆/计算失误/条件遗漏）？
   - 正确的理解方式是什么？
   - 是否属于高频考点？

2. **解题方法与技巧**
   - 某类题型的通用解题思路
   - 关键的解题步骤或公式变换
   - 容易忽略的边界条件或特殊情况
   - 一题多解的对比总结

3. **知识点关联**
   - 跨章节的知识联系（如微分方程与积分的关联）
   - 相似概念的辨析（如收敛与一致收敛）
   - 公式之间的推导关系

4. **笔记整理模式**
   - 发现的高效笔记组织方式
   - 错题分类与标签的最佳实践
   - Obsidian 中适合考研复习的模板结构

### 过滤规则（不提取）

- 单次计算错误（纯粗心，无规律性）
- 已有 skill 覆盖的模式
- 过于基础的定义或公式（教材上直接能查到的）

## Phase 2：整理 Skill 输入

将提取的模式整理为以下结构，准备传递给 `skill-creator`：

- **Skill 名称**：简短的 kebab-case 命名（如 `ode-variable-substitution`、`improper-integral-convergence`）
- **Skill 描述**：一句话说明何时使用此 skill（第三人称，如 "This skill should be used when..."）
- **知识场景**：具体的题型或知识点场景
- **核心方法**：解题思路/易错点总结/知识关联
- **示例**：典型例题或易错对比（如适用）
- **触发条件**：什么情况下应激活此 skill（如遇到某类题型、整理某章节错题时）

向用户展示整理结果，确认后进入 Phase 3。

## Phase 3：调用 skill-creator 创建正式 Skill

使用 `skill-creator` 创建符合标准格式的 Skill：

1. 调用 `/skill-creator`，传入 Phase 2 整理的内容
2. skill-creator 会生成正确的目录结构：
   ```
   .claude/skills/[skill-name]/
   ├── SKILL.md          # 包含 YAML frontmatter (name + description)
   └── references/       # 可选：相关例题、公式推导等参考资料
   ```
3. 确保 SKILL.md 包含正确的 YAML frontmatter：
   ```yaml
   ---
   name: skill-name
   description: This skill should be used when...
   ---
   ```

**重要**：不要直接写入 `~/.claude/skills/learned/` 目录。必须通过 skill-creator 创建带 YAML frontmatter 的正式 SKILL.md，否则系统无法识别。

## Phase 4：确认

- 向用户展示创建的 Skill 路径和内容摘要
- 确认 Skill 出现在可用 skill 列表中
- 建议将相关错题/笔记与新 Skill 关联

## 注意事项

- 每次只提取一个最有价值的学习模式，保持 skill 聚焦
- 优先提取高频考点和反复出错的知识模式
- 考虑知识点在考研真题中的出现频率
- skill-creator 是全局插件，无需额外安装
