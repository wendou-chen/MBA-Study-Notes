const { Plugin, Notice, TFile, TFolder, normalizePath } = require("obsidian");

const SOLVER_NOTE_PATH = "考研数学/解题板.md";
const ERROR_NOTE_ROOT = "考研数学/错题";
const CHECKBOX_REGEX = /^- \[[xX]\] 收录到错题本 [·•] (.+)$/;
const IMAGE_EMBED_REGEX = /!\[\[([^\]]+)\]\]/;

const HEADING_QUESTION = "**📝 题目**";
const HEADING_THOUGHT = "**💡 解题思路**";
const HEADING_ANSWER = "**✅ 最终答案**";

module.exports = class ErrorCollectorPlugin extends Plugin {
  async onload() {
    this.isProcessing = false;

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path !== SOLVER_NOTE_PATH) return;
        if (this.isProcessing) return;

        await this.handleSolverNoteModify(file);
      })
    );
  }

  async handleSolverNoteModify(noteFile) {
    this.isProcessing = true;

    try {
      const content = await this.app.vault.read(noteFile);
      const parsed = this.parseSolverNote(content);

      if (parsed.checkedItems.length === 0) {
        return;
      }

      const successLineIndexes = [];
      const newChapters = [];
      const duplicateChapters = [];
      let failureCount = 0;

      for (const item of parsed.checkedItems) {
        try {
          const result = await this.collectOneItem({
            noteFile,
            chapter: item.chapter,
            imageLink: parsed.imageLink,
            keySentence: parsed.keySentence,
            answerText: parsed.answerText,
          });

          successLineIndexes.push(item.lineIndex);

          if (result && result.isDuplicate) {
            duplicateChapters.push(item.chapter);
          } else {
            newChapters.push(item.chapter);
          }
        } catch (error) {
          failureCount += 1;
          console.error("[error-collector] 收录失败", {
            chapter: item.chapter,
            lineIndex: item.lineIndex,
            error,
          });
        }
      }

      if (successLineIndexes.length > 0) {
        let updatedLines = this.resetProcessedCheckboxes(parsed.lines, successLineIndexes);
        updatedLines = this.appendStatusToLines(updatedLines, newChapters, duplicateChapters);
        const updatedContent = updatedLines.join("\n");
        await this.app.vault.modify(noteFile, updatedContent);
      }

      new Notice(`新增 ${newChapters.length} 条，查重+1 ${duplicateChapters.length} 条`);

      if (failureCount > 0) {
        console.error("[error-collector] 部分收录失败", {
          failureCount,
          total: parsed.checkedItems.length,
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  parseSolverNote(content) {
    const lines = content.split(/\r?\n/);
    const checkedItems = [];

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(CHECKBOX_REGEX);
      if (!match) continue;

      const chapter = match[1].trim();
      if (!chapter) continue;

      checkedItems.push({
        lineIndex: i,
        chapter,
      });
    }

    const imageMatch = content.match(IMAGE_EMBED_REGEX);
    const imageLink = imageMatch ? imageMatch[1].split("|")[0].trim() : "";

    const questionText = this.extractSection(lines, HEADING_QUESTION);
    const thoughtText = this.extractSection(lines, HEADING_THOUGHT);
    const answerText = this.extractSection(lines, HEADING_ANSWER);
    const keySentence = this.extractFirstSentence(thoughtText);

    return {
      lines,
      checkedItems,
      imageLink,
      questionText,
      thoughtText,
      answerText,
      keySentence,
    };
  }

  extractSection(lines, heading) {
    const startIndex = lines.findIndex((line) => line.trim() === heading);
    if (startIndex === -1) return "";

    let endIndex = lines.length;
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (
        /^\*\*.+\*\*$/.test(trimmed) ||
        /^#{1,6}\s/.test(trimmed) ||
        trimmed === "---"
      ) {
        endIndex = i;
        break;
      }
    }

    return lines.slice(startIndex + 1, endIndex).join("\n").trim();
  }

  extractFirstSentence(text) {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) return "（未解析到）";

    const sentenceMatch = compact.match(/^(.+?[。！？!?])/);
    if (sentenceMatch) return sentenceMatch[1].trim();

    const firstLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return firstLine || compact;
  }

  async collectOneItem({ noteFile, chapter, imageLink, keySentence, answerText }) {
    const chapterDir = normalizePath(`${ERROR_NOTE_ROOT}/${chapter}`);
    const imagesDir = normalizePath(`${chapterDir}/images`);
    const chapterFilePath = normalizePath(`${chapterDir}/${chapter}错题.md`);
    console.log("[error-collector] collectOneItem:", { chapter, imageLink, chapterFilePath });

    await this.ensureFolder(chapterDir);
    await this.ensureFolder(imagesDir);

    let copiedImageName = "";
    const sourceImageFile = this.resolveImageFile(imageLink, noteFile);
    if (sourceImageFile) {
      copiedImageName = sourceImageFile.name;
      const targetImagePath = normalizePath(`${imagesDir}/${copiedImageName}`);
      const isDuplicate = await this.copyImageIfNeeded(sourceImageFile, targetImagePath);
      if (isDuplicate) {
        try {
          await this.incrementErrorCount(chapterFilePath, copiedImageName);
          return { isDuplicate: true };
        } catch (_e) {
          // Image exists but no matching record in markdown — treat as new entry
        }
      }
    }

    const record = this.buildErrorRecord({
      chapter,
      imageName: copiedImageName,
      keySentence,
      answerText,
    });
    await this.appendToFile(chapterFilePath, record);
    return { isDuplicate: false };
  }

  resolveImageFile(imageLink, sourceNoteFile) {
    if (!imageLink) return null;

    const cleanLink = imageLink.split("|")[0].trim();
    if (!cleanLink) return null;

    const linked = this.app.metadataCache.getFirstLinkpathDest(cleanLink, sourceNoteFile.path);
    if (linked instanceof TFile) {
      return linked;
    }

    const directPath = normalizePath(cleanLink);
    const directFile = this.app.vault.getAbstractFileByPath(directPath);
    if (directFile instanceof TFile) {
      return directFile;
    }

    const parentPath = sourceNoteFile.parent ? sourceNoteFile.parent.path : "";
    const relativePath = normalizePath(parentPath ? `${parentPath}/${cleanLink}` : cleanLink);
    const relativeFile = this.app.vault.getAbstractFileByPath(relativePath);
    if (relativeFile instanceof TFile) {
      return relativeFile;
    }

    return null;
  }

  async copyImageIfNeeded(sourceFile, targetPath) {
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      return true;
    }
    if (existing) {
      throw new Error(`目标图片路径已存在同名目录: ${targetPath}`);
    }

    const binary = await this.app.vault.readBinary(sourceFile);
    await this.app.vault.createBinary(targetPath, binary);
    return false;
  }

  async incrementErrorCount(filePath, imageName) {
    if (!imageName) {
      throw new Error("缺少 imageName，无法累加错误次数");
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`错题文件不存在，无法累加错误次数: ${filePath}`);
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const imageLine = `![[images/${imageName}]]`;
    const imageIndex = lines.findIndex((line) => line.trim() === imageLine);

    if (imageIndex === -1) {
      throw new Error(`未找到对应图片记录: ${imageLine}`);
    }

    for (let i = imageIndex + 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("![[images/")) {
        break;
      }

      const match = lines[i].match(/^(\s*-\s*\*\*错误次数\*\*:\s*)(\d+)(\s*)$/);
      if (!match) {
        continue;
      }

      const nextCount = Number(match[2]) + 1;
      lines[i] = `${match[1]}${nextCount}${match[3]}`;
      await this.app.vault.modify(file, lines.join("\n"));
      return;
    }

    throw new Error(`未找到错误次数字段，无法累加: ${filePath}`);
  }

  buildErrorRecord({ chapter, imageName, keySentence, answerText }) {
    const imageBlock = imageName ? `![[images/${imageName}]]` : "（未解析到题目图片）";
    const safeKeySentence = keySentence && keySentence.trim() ? keySentence.trim() : "（未解析到）";
    const safeAnswer = answerText && answerText.trim() ? answerText.trim() : "（未解析到）";
    const answerCallout = this.toCallout(safeAnswer);

    return [
      "",
      "---",
      "",
      imageBlock,
      "- **错误次数**: 1",
      `- **错误知识点**: ${chapter}`,
      "- **详细错误原因**：（待填写）",
      `- **解题关键**：${safeKeySentence}`,
      "",
      answerCallout,
      "",
    ].join("\n");
  }

  toCallout(text) {
    const lines = text.split(/\r?\n/);
    const output = ["> [!success] 答案"];

    for (const line of lines) {
      output.push(`> ${line}`);
    }

    return output.join("\n");
  }

  async appendToFile(filePath, block) {
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      const current = await this.app.vault.read(existing);
      const normalizedBlock = block.trimStart();
      const next = current.endsWith("\n") ? `${current}${normalizedBlock}` : `${current}\n${normalizedBlock}`;
      await this.app.vault.modify(existing, next);
      return;
    }

    if (existing) {
      throw new Error(`目标错题文件路径被目录占用: ${filePath}`);
    }

    await this.app.vault.create(filePath, block.trimStart());
  }

  async ensureFolder(folderPath) {
    const normalized = normalizePath(folderPath);
    if (!normalized) return;

    const parts = normalized.split("/");
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);

      if (!existing) {
        await this.app.vault.createFolder(current);
        continue;
      }

      if (!(existing instanceof TFolder)) {
        throw new Error(`路径已存在且不是文件夹: ${current}`);
      }
    }
  }

  resetProcessedCheckboxes(lines, successLineIndexes) {
    const successSet = new Set(successLineIndexes);
    return lines.map((line, index) => {
      if (!successSet.has(index)) return line;
      return line.replace(/^- \[[xX]\]/, "- [ ]");
    });
  }

  appendStatusToLines(lines, newChapters, duplicateChapters) {
    if (newChapters.length === 0 && duplicateChapters.length === 0) {
      return lines;
    }

    const dateText = this.getTodayDateString();
    const statusLines = [];

    for (const chapter of newChapters) {
      statusLines.push(`✅ 已收录：${chapter}（${dateText}，首次添加）`);
    }

    for (const chapter of duplicateChapters) {
      statusLines.push(`🔁 已更新：${chapter}（${dateText}，错误次数 +1）`);
    }

    const updated = [...lines];
    let lastCheckboxIndex = -1;

    for (let i = 0; i < updated.length; i += 1) {
      if (/^- \[[ xX]\] 收录到错题本/.test(updated[i])) {
        lastCheckboxIndex = i;
      }
    }

    if (lastCheckboxIndex === -1) {
      if (updated.length > 0 && updated[updated.length - 1].trim() !== "") {
        updated.push("");
      }
      updated.push(...statusLines);
      return updated;
    }

    updated.splice(lastCheckboxIndex + 1, 0, "", ...statusLines);
    return updated;
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
};
