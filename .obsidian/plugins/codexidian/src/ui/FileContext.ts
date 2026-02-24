import type { App } from "obsidian";

const MAX_RESULTS = 10;

export class FileContext {
  private files: Set<string> = new Set();
  private searchEl: HTMLElement | null = null;
  private queryStart = -1;
  private queryEnd = -1;
  private readonly chipsEl: HTMLElement;
  private readonly inputWrapperEl: HTMLElement;
  private readonly onInputBound: (event: Event) => void;
  private readonly onOutsideClickBound: (event: MouseEvent) => void;

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
  ) {
    this.chipsEl = containerEl.createDiv({ cls: "codexidian-file-chips" });
    this.inputWrapperEl = (this.inputEl.parentElement as HTMLElement) ?? containerEl;

    this.onInputBound = (event) => {
      try {
        this.handleInput(event);
      } catch {
        this.hideSearch();
      }
    };
    this.onOutsideClickBound = (event) => {
      try {
        this.handleOutsideClick(event);
      } catch {
        this.hideSearch();
      }
    };

    this.inputEl.addEventListener("input", this.onInputBound);
    document.addEventListener("mousedown", this.onOutsideClickBound);
  }

  getFiles(): string[] {
    return Array.from(this.files);
  }

  clear(): void {
    this.files.clear();
    this.renderChips();
    this.hideSearch();
  }

  destroy(): void {
    this.inputEl.removeEventListener("input", this.onInputBound);
    document.removeEventListener("mousedown", this.onOutsideClickBound);
    this.hideSearch();
    this.chipsEl.empty();
  }

  private handleInput(_event: Event): void {
    const value = this.inputEl.value;
    const cursor = this.inputEl.selectionStart ?? value.length;
    const prefix = value.slice(0, cursor);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);

    if (!match) {
      this.hideSearch();
      return;
    }

    const query = match[1] ?? "";
    this.queryStart = cursor - query.length - 1;
    this.queryEnd = cursor;

    const normalized = query.toLowerCase();
    const results = this.app.vault.getFiles()
      .map((file) => file.path)
      .filter((path) => !this.files.has(path))
      .filter((path) => normalized.length === 0 || path.toLowerCase().includes(normalized))
      .slice(0, MAX_RESULTS);

    if (results.length === 0) {
      this.hideSearch();
      return;
    }

    this.renderSearch(results);
  }

  private renderSearch(paths: string[]): void {
    this.hideSearch();
    this.searchEl = this.inputWrapperEl.createDiv({ cls: "codexidian-file-search" });
    for (const path of paths) {
      const item = this.searchEl.createDiv({
        cls: "codexidian-file-search-item",
        text: path,
      });
      item.addEventListener("click", () => {
        this.addFile(path);
      });
    }
  }

  private hideSearch(): void {
    if (this.searchEl) {
      this.searchEl.remove();
      this.searchEl = null;
    }
    this.queryStart = -1;
    this.queryEnd = -1;
  }

  private addFile(path: string): void {
    this.files.add(path);
    this.renderChips();

    const value = this.inputEl.value;
    if (this.queryStart >= 0 && this.queryEnd >= this.queryStart) {
      const before = value.slice(0, this.queryStart);
      const after = value.slice(this.queryEnd);
      this.inputEl.value = `${before}${after}`;
      const cursor = before.length;
      this.inputEl.selectionStart = cursor;
      this.inputEl.selectionEnd = cursor;
    }

    this.hideSearch();
    this.inputEl.focus();
  }

  private renderChips(): void {
    this.chipsEl.empty();
    for (const path of this.files) {
      const chip = this.chipsEl.createDiv({ cls: "codexidian-file-chip" });
      chip.createSpan({ cls: "codexidian-file-chip-text", text: path });
      const remove = chip.createSpan({ cls: "codexidian-file-chip-remove", text: "✕" });
      remove.addEventListener("click", () => {
        this.files.delete(path);
        this.renderChips();
      });
    }
  }

  private handleOutsideClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (!target) return;
    if (target === this.inputEl) return;
    if (this.searchEl && this.searchEl.contains(target)) return;
    this.hideSearch();
  }
}
