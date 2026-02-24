interface ImageAttachment {
  name: string;
  dataUrl: string;
}

export class ImageContext {
  private images: ImageAttachment[] = [];
  private readonly previewsEl: HTMLElement;
  private readonly onPasteBound: (event: ClipboardEvent) => void;

  constructor(
    containerEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
  ) {
    this.previewsEl = containerEl.createDiv({ cls: "codexidian-image-previews" });
    this.onPasteBound = (event) => {
      void this.handlePaste(event);
    };
    this.inputEl.addEventListener("paste", this.onPasteBound);
  }

  getImages(): Array<{ name: string; dataUrl: string }> {
    return this.images.map((image) => ({ ...image }));
  }

  clear(): void {
    this.images = [];
    this.render();
  }

  destroy(): void {
    this.inputEl.removeEventListener("paste", this.onPasteBound);
    this.clear();
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    try {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems || clipboardItems.length === 0) {
        return;
      }

      let foundImage = false;
      for (const item of Array.from(clipboardItems)) {
        if (!item.type.startsWith("image/")) {
          continue;
        }
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        foundImage = true;
        const dataUrl = await this.fileToDataUrl(file);
        this.images.push({
          name: file.name || `pasted-image-${Date.now()}.png`,
          dataUrl,
        });
      }

      if (foundImage) {
        event.preventDefault();
        this.render();
      }
    } catch {
      // No-op: image paste should degrade silently.
    }
  }

  private render(): void {
    this.previewsEl.empty();
    if (this.images.length === 0) {
      this.previewsEl.style.display = "none";
      return;
    }
    this.previewsEl.style.display = "flex";

    this.images.forEach((image, index) => {
      const preview = this.previewsEl.createDiv({ cls: "codexidian-image-preview" });
      const img = preview.createEl("img");
      img.src = image.dataUrl;
      img.alt = image.name;
      img.title = image.name;

      const remove = preview.createEl("button", {
        cls: "codexidian-image-preview-remove",
        text: "✕",
      });
      remove.addEventListener("click", () => {
        this.images.splice(index, 1);
        this.render();
      });
    });
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
}
