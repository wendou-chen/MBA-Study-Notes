interface ImageAttachment {
  name: string;
  dataUrl: string;
  sizeBytes: number;
  path?: string;
}

interface ImageContextOptions {
  dropTargetEl?: HTMLElement;
  onDropZoneActiveChange?: (active: boolean) => void;
  onLimitReached?: (max: number) => void;
  onFilesIgnored?: (count: number) => void;
  onReadFailure?: (fileName: string) => void;
}

export class ImageContext {
  static readonly MAX_ATTACHMENTS = 5;

  private images: ImageAttachment[] = [];
  private readonly previewsEl: HTMLElement;
  private readonly dropTargetEl: HTMLElement | null;
  private readonly onDropZoneActiveChange?: (active: boolean) => void;
  private readonly onLimitReached?: (max: number) => void;
  private readonly onFilesIgnored?: (count: number) => void;
  private readonly onReadFailure?: (fileName: string) => void;
  private readonly onPasteBound: (event: ClipboardEvent) => void;
  private readonly onDragEnterBound: (event: DragEvent) => void;
  private readonly onDragOverBound: (event: DragEvent) => void;
  private readonly onDragLeaveBound: (event: DragEvent) => void;
  private readonly onDropBound: (event: DragEvent) => void;
  private dragDepth = 0;
  private dropZoneActive = false;

  constructor(
    containerEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
    options: ImageContextOptions = {},
  ) {
    this.dropTargetEl = options.dropTargetEl ?? null;
    this.onDropZoneActiveChange = options.onDropZoneActiveChange;
    this.onLimitReached = options.onLimitReached;
    this.onFilesIgnored = options.onFilesIgnored;
    this.onReadFailure = options.onReadFailure;
    this.previewsEl = containerEl.createDiv({ cls: "codexidian-image-previews" });
    this.onPasteBound = (event) => {
      void this.handlePaste(event);
    };
    this.onDragEnterBound = (event) => {
      this.handleDragEnter(event);
    };
    this.onDragOverBound = (event) => {
      this.handleDragOver(event);
    };
    this.onDragLeaveBound = (event) => {
      this.handleDragLeave(event);
    };
    this.onDropBound = (event) => {
      void this.handleDrop(event);
    };
    this.inputEl.addEventListener("paste", this.onPasteBound);
    if (this.dropTargetEl) {
      this.dropTargetEl.addEventListener("dragenter", this.onDragEnterBound);
      this.dropTargetEl.addEventListener("dragover", this.onDragOverBound);
      this.dropTargetEl.addEventListener("dragleave", this.onDragLeaveBound);
      this.dropTargetEl.addEventListener("drop", this.onDropBound);
    }
  }

  getImages(): Array<{ name: string; dataUrl: string; path?: string }> {
    return this.images.map((image) => ({
      name: image.name,
      dataUrl: image.dataUrl,
      path: image.path,
    }));
  }

  async addFiles(files: FileList | File[]): Promise<number> {
    try {
      const fileList = Array.isArray(files) ? files : Array.from(files);
      return await this.ingestFiles(fileList);
    } catch {
      return 0;
    }
  }

  clear(): void {
    this.images = [];
    this.dragDepth = 0;
    this.setDropZoneActive(false);
    this.render();
  }

  destroy(): void {
    this.inputEl.removeEventListener("paste", this.onPasteBound);
    if (this.dropTargetEl) {
      this.dropTargetEl.removeEventListener("dragenter", this.onDragEnterBound);
      this.dropTargetEl.removeEventListener("dragover", this.onDragOverBound);
      this.dropTargetEl.removeEventListener("dragleave", this.onDragLeaveBound);
      this.dropTargetEl.removeEventListener("drop", this.onDropBound);
    }
    this.clear();
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    try {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems || clipboardItems.length === 0) {
        return;
      }

      const files: File[] = [];
      for (const item of Array.from(clipboardItems)) {
        if (!item.type.startsWith("image/")) {
          continue;
        }
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        files.push(file);
      }

      if (files.length > 0) {
        event.preventDefault();
        await this.ingestFiles(files);
      }
    } catch {
      // No-op: image paste should degrade silently.
    }
  }

  private handleDragEnter(event: DragEvent): void {
    if (!this.hasImageFiles(event.dataTransfer)) {
      return;
    }
    this.dragDepth += 1;
    this.setDropZoneActive(true);
  }

  private handleDragOver(event: DragEvent): void {
    if (!this.hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    this.setDropZoneActive(true);
  }

  private handleDragLeave(event: DragEvent): void {
    if (!this.dropZoneActive) {
      return;
    }

    const target = event.target as Node | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (
      this.dropTargetEl
      && target
      && this.dropTargetEl.contains(target)
      && relatedTarget
      && this.dropTargetEl.contains(relatedTarget)
    ) {
      return;
    }

    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.setDropZoneActive(false);
    }
  }

  private async handleDrop(event: DragEvent): Promise<void> {
    const files = event.dataTransfer?.files;
    this.dragDepth = 0;
    this.setDropZoneActive(false);

    if (!files || files.length === 0) {
      return;
    }

    if (!this.hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    await this.ingestFiles(Array.from(files));
  }

  private async ingestFiles(files: File[]): Promise<number> {
    if (files.length === 0) {
      return 0;
    }

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const ignoredCount = files.length - imageFiles.length;
    if (ignoredCount > 0) {
      try {
        this.onFilesIgnored?.(ignoredCount);
      } catch {
        // Keep image intake functional even when notice callbacks fail.
      }
    }

    if (imageFiles.length === 0) {
      return 0;
    }

    const remaining = ImageContext.MAX_ATTACHMENTS - this.images.length;
    if (remaining <= 0) {
      try {
        this.onLimitReached?.(ImageContext.MAX_ATTACHMENTS);
      } catch {
        // Best effort callback only.
      }
      return 0;
    }

    if (imageFiles.length > remaining) {
      try {
        this.onLimitReached?.(ImageContext.MAX_ATTACHMENTS);
      } catch {
        // Best effort callback only.
      }
    }

    const selected = imageFiles.slice(0, remaining);
    let added = 0;

    for (const file of selected) {
      try {
        const dataUrl = await this.fileToDataUrl(file);
        const localPath = this.extractLocalPath(file);
        this.images.push({
          name: this.getAttachmentName(file, added),
          dataUrl,
          sizeBytes: file.size,
          path: localPath,
        });
        added += 1;
      } catch {
        try {
          this.onReadFailure?.(file.name || "image");
        } catch {
          // Best effort callback only.
        }
      }
    }

    if (added > 0) {
      this.render();
    }

    return added;
  }

  private render(): void {
    this.previewsEl.empty();
    if (this.images.length === 0) {
      this.previewsEl.style.display = "none";
      return;
    }
    this.previewsEl.style.display = "flex";

    this.images.forEach((image, index) => {
      const preview = this.previewsEl.createDiv({ cls: "codexidian-attachment-chip" });
      const thumb = preview.createDiv({ cls: "codexidian-attachment-thumb" });
      const img = thumb.createEl("img");
      img.src = image.dataUrl;
      img.alt = image.name;
      img.title = image.name;

      const info = preview.createDiv({ cls: "codexidian-attachment-info" });
      info.createDiv({ cls: "codexidian-attachment-name", text: image.name });
      info.createDiv({
        cls: "codexidian-attachment-size",
        text: this.formatSize(image.sizeBytes),
      });

      const remove = preview.createEl("button", {
        cls: "codexidian-attachment-remove",
        text: "✕",
      });
      remove.type = "button";
      remove.addEventListener("click", () => {
        this.images.splice(index, 1);
        this.render();
      });
    });
  }

  private setDropZoneActive(active: boolean): void {
    if (this.dropZoneActive === active) {
      return;
    }
    this.dropZoneActive = active;
    try {
      this.onDropZoneActiveChange?.(active);
    } catch {
      // Best effort callback only.
    }
  }

  private hasImageFiles(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) {
      return false;
    }

    const hasFilesType = Array.from(dataTransfer.types ?? []).includes("Files");
    if (!hasFilesType) {
      return false;
    }

    if (dataTransfer.items && dataTransfer.items.length > 0) {
      return Array.from(dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return Array.from(dataTransfer.files).some((file) => file.type.startsWith("image/"));
    }

    return false;
  }

  private getAttachmentName(file: File, index: number): string {
    if (file.name && file.name.trim().length > 0) {
      return file.name.trim();
    }
    return `image-${Date.now()}-${index + 1}.png`;
  }

  private formatSize(sizeBytes: number): string {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }
    if (sizeBytes < 1024 * 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result);
      };
      reader.onerror = () => {
        reject(new Error("failed to read image"));
      };
      reader.readAsDataURL(file);
    });
  }

  private extractLocalPath(file: File): string | undefined {
    const candidate = (file as File & { path?: unknown }).path;
    if (typeof candidate !== "string") {
      return undefined;
    }
    const normalized = candidate.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
