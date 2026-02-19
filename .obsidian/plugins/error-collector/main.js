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
      let failureCount = 0;

      for (const item of parsed.checkedItems) {
        try {
          await this.collectOneItem({
            noteFile,
            chapter: item.chapter,
            imageLink: parsed.imageLink,
            keySentence: parsed.keySentence,
            answerText: parsed.answerText,
          });
          successLineIndexes.push(item.lineIndex);
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
        const updatedContent = this.resetProcessedCheckboxes(parsed.lines, successLineIndexes).join("\n");
        await this.app.vault.modify(noteFile, updatedContent);
      }

      if (successLineIndexes.length > 0 && failureCount === 0) {
        new Notice(`错题收录完成：成功 ${successLineIndexes.length} 条。`);
      } else {
        new Notice(`错题收录完成：成功 ${successLineIndexes.length} 条，失败 ${failureCount} 条。`);
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

    await this.ensureFolder(chapterDir);
    await this.ensureFolder(imagesDir);

    let copiedImageName = "";
    const sourceImageFile = this.resolveImageFile(imageLink, noteFile);
    if (sourceImageFile) {
      copiedImageName = sourceImageFile.name;
      const targetImagePath = normalizePath(`${imagesDir}/${copiedImageName}`);
      await this.copyImageIfNeeded(sourceImageFile, targetImagePath);
    }

    const record = this.buildErrorRecord({
      chapter,
      imageName: copiedImageName,
      keySentence,
      answerText,
    });

    await this.appendToFile(chapterFilePath, record);
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
      return;
    }
    if (existing) {
      throw new Error(`目标图片路径已存在同名目录: ${targetPath}`);
    }

    const binary = await this.app.vault.readBinary(sourceFile);
    await this.app.vault.createBinary(targetPath, binary);
  }

  buildErrorRecord({ chapter, imageName, keySentence, answerText }) {
    const imageBlock = imageName ? `![[images/${imageName}]]` : "（未解析到题目图片）";
    const safeKeySentence = keySentence && keySentence.trim() ? keySentence.trim() : "（未解析到）";
    const safeAnswer = answerText && answerText.trim() ? answerText.trim() : "（未解析到）";
    const answerCallout = this.toCallout(safeAnswer);

    return [
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
};
