import {
  App,
  Component,
  FuzzySuggestModal,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  loadPdfJs,
  normalizePath,
} from "obsidian";

import {
  buildOutlineMarkdown,
  getBookmarkedPdfExportPath,
  getOutlineExportPath,
  getPdfBookmarkHeadings,
  getPrintableBookmarkedPdfMarkdown,
  isPdfTocHeadingTitle,
  mapPdfBookmarkHeadingsToPages,
  needsSyntheticPdfRootHeading,
  parseMarkdownHeadings,
  type OutlineHeading,
  type PdfBookmarkTarget,
} from "./outlineMarkdown";
import {
  addPdfBookmarks,
  finalizeBookmarkedPdf,
  PDF_PRINT_ANCHOR_URI_PREFIX,
  type PdfAnchorTarget,
} from "./pdfOutline";

type CurrentFileAction = "copy" | "export" | "bookmarked-pdf" | "pdf";

interface PrintToPdfWebContents {
  printToPDF(options: Record<string, unknown>): Promise<ArrayBuffer | Uint8Array>;
}

interface ElectronRemoteLike {
  getCurrentWebContents?: () => PrintToPdfWebContents;
  getCurrentWindow?: () => { webContents?: PrintToPdfWebContents };
}

type WindowWithRequire = Window & {
  require?: (moduleName: string) => unknown;
};

const PRINT_CONTAINER_CLASS = "outline-markdown-export-print-root";
const PRINT_ANCHOR_CLASS = "outline-markdown-export-print-anchor";
// Electron 的 generateDocumentOutline 存在静默失效问题（electron/electron#45124），
// 书签不依赖它，由 finalizeBookmarkedPdf 通过锚点回读自行写入 /Outlines。
// 关键：锚点不能用 opacity:0/visibility:hidden/display:none，否则 Chromium
// 不会为其生成 PDF Link annotation（better-export-pdf 的实测结论）。
const PDF_PRINT_OPTIONS: Record<string, unknown> = {
  pageSize: "A4",
  landscape: false,
  printBackground: true,
  preferCSSPageSize: true,
};

export default class OutlineMarkdownExportPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "copy-current-outline-markdown",
      name: "复制当前文件大纲 Markdown",
      checkCallback: (checking) => this.handleCurrentFileCommand(checking, "copy"),
    });

    this.addCommand({
      id: "export-current-outline-markdown",
      name: "导出当前文件大纲 Markdown",
      checkCallback: (checking) => this.handleCurrentFileCommand(checking, "export"),
    });

    if (Platform.isDesktopApp) {
      this.addCommand({
        id: "export-current-note-bookmarked-pdf",
        name: "导出带书签 PDF",
        checkCallback: (checking) => this.handleCurrentFileCommand(checking, "bookmarked-pdf"),
      });

      this.addCommand({
        id: "add-bookmarks-to-native-pdf",
        name: "为原生导出的 PDF 添加书签",
        checkCallback: (checking) => this.handleCurrentFileCommand(checking, "pdf"),
      });
    }

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, info) => {
        const file = info.file;
        if (!this.isMarkdownFile(file)) {
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle("复制大纲 Markdown")
            .setIcon("copy")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.copyOutlineForFile(file);
            }),
        );

        menu.addItem((item) =>
          item
            .setTitle("导出大纲 Markdown")
            .setIcon("file-output")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.exportOutlineForFile(file);
            }),
        );

        if (Platform.isDesktopApp) {
          menu.addItem((item) =>
            item
              .setTitle("导出带书签 PDF")
              .setIcon("file-output")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.exportBookmarkedPdfForFile(file);
              }),
          );

          menu.addItem((item) =>
            item
              .setTitle("为原生 PDF 添加书签")
              .setIcon("bookmark")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.addBookmarksToNativePdfForFile(file);
              }),
          );
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!this.isMarkdownFile(file)) {
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle("复制大纲 Markdown")
            .setIcon("copy")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.copyOutlineForFile(file);
            }),
        );

        menu.addItem((item) =>
          item
            .setTitle("导出大纲 Markdown")
            .setIcon("file-output")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.exportOutlineForFile(file);
            }),
        );

        if (Platform.isDesktopApp) {
          menu.addItem((item) =>
            item
              .setTitle("导出带书签 PDF")
              .setIcon("file-output")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.exportBookmarkedPdfForFile(file);
              }),
          );

          menu.addItem((item) =>
            item
              .setTitle("为原生 PDF 添加书签")
              .setIcon("bookmark")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.addBookmarksToNativePdfForFile(file);
              }),
          );
        }
      }),
    );
  }

  private handleCurrentFileCommand(checking: boolean, action: CurrentFileAction): boolean {
    const file = this.getCurrentMarkdownFile();
    if (!file) {
      return false;
    }

    if (!checking) {
      if (action === "copy") {
        void this.copyOutlineForFile(file);
      } else if (action === "export") {
        void this.exportOutlineForFile(file);
      } else if (action === "bookmarked-pdf") {
        void this.exportBookmarkedPdfForFile(file);
      } else {
        void this.addBookmarksToNativePdfForFile(file);
      }
    }

    return true;
  }

  private getCurrentMarkdownFile(): TFile | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeMarkdownView?.file ?? this.app.workspace.getActiveFile();
    return this.isMarkdownFile(activeFile) ? activeFile : null;
  }

  private isMarkdownFile(file: TAbstractFile | null): file is TFile {
    return file instanceof TFile && file.extension.toLowerCase() === "md";
  }

  private isNativePdfCandidate(file: TFile): boolean {
    return file.extension.toLowerCase() === "pdf" && !file.basename.endsWith(".bookmarked");
  }

  private getOutlineMarkdown(file: TFile): string {
    const headings = this.getLiveHeadings(file) ?? this.getCachedHeadings(file);
    return buildOutlineMarkdown(headings, file.basename);
  }

  private getLiveHeadings(file: TFile): OutlineHeading[] | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeMarkdownView?.file || activeMarkdownView.file.path !== file.path) {
      return null;
    }

    return parseMarkdownHeadings(activeMarkdownView.getViewData());
  }

  private getCachedHeadings(file: TFile): OutlineHeading[] {
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.headings ?? []).map((heading) => ({
      heading: heading.heading,
      level: heading.level,
    }));
  }

  private async copyOutlineForFile(file: TFile): Promise<void> {
    const markdown = this.getOutlineMarkdown(file);
    if (!markdown) {
      new Notice("当前 Markdown 文件没有可复制的大纲");
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
      new Notice(`已复制大纲 Markdown：${file.basename}`);
    } catch (error) {
      console.error("Failed to copy outline markdown", error);
      new Notice("复制大纲 Markdown 失败");
    }
  }

  private async exportOutlineForFile(file: TFile): Promise<void> {
    const markdown = this.getOutlineMarkdown(file);
    if (!markdown) {
      new Notice("当前 Markdown 文件没有可导出的大纲");
      return;
    }

    const exportPath = normalizePath(getOutlineExportPath(file.path));
    const existing = this.app.vault.getAbstractFileByPath(exportPath);

    try {
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, `${markdown}\n`);
      } else if (existing) {
        new Notice(`导出失败：目标路径不是文件 ${exportPath}`);
        return;
      } else {
        await this.app.vault.create(exportPath, `${markdown}\n`);
      }

      new Notice(`已导出大纲 Markdown：${exportPath}`);
    } catch (error) {
      console.error("Failed to export outline markdown", error);
      new Notice("导出大纲 Markdown 失败");
    }
  }

  private async exportBookmarkedPdfForFile(file: TFile): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("带书签 PDF 导出仅支持 Obsidian 桌面端");
      return;
    }

    try {
      const markdown = await this.getMarkdownContent(file);
      const printableMarkdown = getPrintableBookmarkedPdfMarkdown(markdown, file.basename);
      const printed = await this.printMarkdownToPdf(file, printableMarkdown);
      const finalized = await finalizeBookmarkedPdf(printed.pdfBytes, printed.anchors);
      const outputPath = normalizePath(getBookmarkedPdfExportPath(file.path));
      await this.writeBinaryVaultFile(outputPath, this.toArrayBuffer(finalized.bytes));

      if (finalized.matchedCount > 0) {
        new Notice(`已导出带书签 PDF（${finalized.matchedCount} 个书签）：${outputPath}`);
      } else {
        new Notice(
          `已导出 PDF，但未能定位标题锚点。可改用「为原生导出的 PDF 添加书签」：${outputPath}`,
        );
      }
    } catch (error) {
      console.error("Failed to export bookmarked PDF", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`导出带书签 PDF 失败：${message}`);
    }
  }

  private async printMarkdownToPdf(
    file: TFile,
    markdown: string,
  ): Promise<{ pdfBytes: Uint8Array; anchors: PdfAnchorTarget[] }> {
    const webContents = this.getCurrentWebContents();
    if (!webContents) {
      throw new Error("无法访问 Electron printToPDF，请确认正在 Obsidian 桌面端运行");
    }

    const component = new Component();
    const { wrapper, content } = this.createPrintContainer();
    const style = this.injectPrintStyle();
    component.load();

    try {
      await MarkdownRenderer.render(this.app, markdown, content, file.path, component);
      const anchors = this.injectHeadingPrintAnchors(content);
      await this.waitForRenderToSettle(content);

      const pdfData = await webContents.printToPDF(PDF_PRINT_OPTIONS);
      const pdfBytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
      return { pdfBytes, anchors };
    } finally {
      component.unload();
      wrapper.remove();
      style.remove();
    }
  }

  // Chromium printToPDF 会为"可见的" <a> 链接生成 PDF Link annotation，
  // 但跳过 opacity:0 / visibility:hidden / display:none 的元素。
  // 因此锚点用 position:absolute; width:1px; height:1px; right:0 实现视觉隐藏，
  // 保证 Chromium 将其视为"已渲染的可交互元素"并写入 Link annotation。
  // 参考：obsidian-better-export-pdf 的 CSS_PATCH / styles.css。
  private injectHeadingPrintAnchors(container: HTMLElement): PdfAnchorTarget[] {
    const anchors: PdfAnchorTarget[] = [];

    for (const heading of Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3"))) {
      const title = (heading.textContent ?? "").trim();
      if (!title || isPdfTocHeadingTitle(title)) {
        continue;
      }

      const key = `omx-${anchors.length}`;
      const anchor = document.createElement("a");
      anchor.href = `${PDF_PRINT_ANCHOR_URI_PREFIX}${key}`;
      anchor.className = PRINT_ANCHOR_CLASS;
      heading.style.position = "relative";
      heading.prepend(anchor);

      anchors.push({
        key,
        heading: title,
        level: Number(heading.tagName.slice(1)),
      });
    }

    return anchors;
  }

  // Obsidian 的打印样式表在 @media print 下只放行 `body > .print`，其余一律
  // display:none !important；容器必须复用 `.print > .markdown-preview-view`
  // 结构才能进入打印输出（v1/v3 白页的根因）。
  private createPrintContainer(): { wrapper: HTMLElement; content: HTMLElement } {
    const wrapper = document.createElement("div");
    wrapper.className = `print ${PRINT_CONTAINER_CLASS}`;

    const content = document.createElement("div");
    content.className = "markdown-preview-view markdown-rendered";
    wrapper.appendChild(content);
    document.body.appendChild(wrapper);

    return { wrapper, content };
  }

  private injectPrintStyle(): HTMLStyleElement {
    const style = document.createElement("style");
    style.textContent = `
      @page {
        size: A4 portrait;
        margin: 16mm;
      }

      .${PRINT_CONTAINER_CLASS} {
        display: none;
      }

      @media print {
        .${PRINT_CONTAINER_CLASS} {
          display: block !important;
          background: #ffffff !important;
        }

        .${PRINT_CONTAINER_CLASS} .${PRINT_ANCHOR_CLASS} {
          white-space: pre !important;
          border-left: none !important;
          border-right: none !important;
          border-top: none !important;
          border-bottom: none !important;
          display: inline-block !important;
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          right: 0 !important;
          outline: 0 !important;
          background: 0 0 !important;
          text-decoration: initial !important;
          text-shadow: initial !important;
        }
      }
    `;
    document.head.appendChild(style);
    return style;
  }

  private async waitForRenderToSettle(container: HTMLElement): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    await fonts?.ready?.catch(() => undefined);

    // MathJax 排版是异步的，字体/图片就绪后再留一小段静置时间。
    await new Promise<void>((resolve) => window.setTimeout(resolve, 400));

    const imagePromises = Array.from(container.querySelectorAll("img"))
      .filter((image) => !image.complete)
      .map((image) => new Promise<void>((resolve) => {
        const finish = (): void => resolve();
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      }));

    if (imagePromises.length === 0) {
      return;
    }

    await Promise.race([
      Promise.all(imagePromises),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
    ]);
  }

  private getCurrentWebContents(): PrintToPdfWebContents | null {
    const requireFn = (window as WindowWithRequire).require?.bind(window);
    if (!requireFn) {
      return null;
    }

    try {
      const electron = requireFn("electron") as { remote?: ElectronRemoteLike } | null;
      const remote = electron?.remote ?? (requireFn("@electron/remote") as ElectronRemoteLike | null);
      return remote?.getCurrentWebContents?.() ?? remote?.getCurrentWindow?.().webContents ?? null;
    } catch (error) {
      console.error("Failed to access Electron webContents", error);
      return null;
    }
  }

  private async addBookmarksToNativePdfForFile(markdownFile: TFile): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("PDF 书签处理仅支持 Obsidian 桌面端");
      return;
    }

    try {
      const pdfFile = await this.resolveNativePdfFile(markdownFile);
      if (!pdfFile) {
        return;
      }

      const markdown = await this.getMarkdownContent(markdownFile);
      const markdownHeadings = parseMarkdownHeadings(markdown);
      const bookmarkHeadings = getPdfBookmarkHeadings(markdownHeadings);
      if (bookmarkHeadings.length === 0 && !needsSyntheticPdfRootHeading(markdownHeadings)) {
        new Notice("当前 Markdown 文件没有可写入 PDF 的标题");
        return;
      }

      const inputPdfBytes = await this.app.vault.readBinary(pdfFile);
      const pageTexts = await this.extractPdfPageTexts(inputPdfBytes);
      const targets = this.buildBookmarkTargets(markdownFile, markdownHeadings, pageTexts);
      if (targets.length === 0) {
        new Notice("没有在 PDF 中匹配到 Markdown 标题，请确认选择的是该笔记的原生导出 PDF");
        return;
      }

      const outputBytes = await addPdfBookmarks(inputPdfBytes, targets);
      const outputPath = normalizePath(getBookmarkedPdfExportPath(pdfFile.path));
      await this.writeBinaryVaultFile(outputPath, this.toArrayBuffer(outputBytes));

      new Notice(`已添加 ${targets.length} 个 PDF 书签：${outputPath}`);
    } catch (error) {
      console.error("Failed to add PDF bookmarks", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`添加 PDF 书签失败：${message}`);
    }
  }

  private async resolveNativePdfFile(markdownFile: TFile): Promise<TFile | null> {
    const defaultPath = normalizePath(markdownFile.path.replace(/\.md$/i, ".pdf"));
    const defaultFile = this.app.vault.getAbstractFileByPath(defaultPath);
    if (defaultFile instanceof TFile && this.isNativePdfCandidate(defaultFile)) {
      return defaultFile;
    }

    const candidates = this.app.vault
      .getFiles()
      .filter((file) => this.isNativePdfCandidate(file))
      .sort((left, right) => this.scorePdfCandidate(markdownFile, right) - this.scorePdfCandidate(markdownFile, left));

    if (candidates.length === 0) {
      new Notice("未找到可处理的 PDF。请先用 Obsidian 原生功能导出 PDF。");
      return null;
    }

    new Notice("未找到同名 PDF，请在弹出的列表中选择原生导出的 PDF。");
    return new Promise<TFile | null>((resolve) => {
      new PdfFileSuggestModal(this.app, candidates, resolve).open();
    });
  }

  private scorePdfCandidate(markdownFile: TFile, pdfFile: TFile): number {
    let score = 0;
    if (this.getFolder(markdownFile.path) === this.getFolder(pdfFile.path)) {
      score += 100;
    }
    if (pdfFile.basename === markdownFile.basename) {
      score += 50;
    }
    if (pdfFile.basename.includes(markdownFile.basename) || markdownFile.basename.includes(pdfFile.basename)) {
      score += 10;
    }
    return score;
  }

  private getFolder(path: string): string {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  private async getMarkdownContent(file: TFile): Promise<string> {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView?.file?.path === file.path) {
      return activeMarkdownView.getViewData();
    }

    return this.app.vault.cachedRead(file);
  }

  private buildBookmarkTargets(
    markdownFile: TFile,
    markdownHeadings: OutlineHeading[],
    pageTexts: string[],
  ): PdfBookmarkTarget[] {
    const targets = mapPdfBookmarkHeadingsToPages(markdownHeadings, pageTexts);
    if (needsSyntheticPdfRootHeading(markdownHeadings)) {
      targets.unshift({
        heading: markdownFile.basename,
        level: 1,
        pageIndex: 0,
      });
    }
    return targets;
  }

  private async extractPdfPageTexts(pdfData: ArrayBuffer | Uint8Array): Promise<string[]> {
    const pdfjsLib = await loadPdfJs();
    const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdfDocument = await loadingTask.promise;
    const pageTexts: string[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item: { str?: string }) => item.str ?? "")
          .join("");
        pageTexts.push(text);
      }
    } finally {
      await loadingTask.destroy?.();
      await pdfDocument.destroy?.();
    }

    return pageTexts;
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  private async writeBinaryVaultFile(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
      return;
    }

    if (existing) {
      throw new Error(`目标路径不是文件：${path}`);
    }

    await this.app.vault.createBinary(path, data);
  }
}

class PdfFileSuggestModal extends FuzzySuggestModal<TFile> {
  private resolved = false;

  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("选择 Obsidian 原生导出的 PDF");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.resolved = true;
    this.resolve(file);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
  }
}
