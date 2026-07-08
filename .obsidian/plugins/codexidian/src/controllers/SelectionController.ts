import { MarkdownView, type App } from "obsidian";
import type { EditorContext } from "../types";
import { t, tf } from "../i18n";

const POLL_INTERVAL = 250;

export class SelectionController {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private current: EditorContext | null = null;
  private indicatorEl: HTMLElement | null = null;
  private enabled = true;
  private onContextChanged: (() => void) | null = null;

  constructor(private readonly app: App) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.current = null;
      this.updateIndicator();
    }
  }

  getContext(): EditorContext | null {
    return this.current;
  }

  setOnContextChanged(callback: (() => void) | null): void {
    this.onContextChanged = callback;
  }

  start(indicatorEl: HTMLElement): void {
    this.indicatorEl = indicatorEl;
    this.stop();
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.current = null;
    this.updateIndicator();
  }

  private poll(): void {
    if (!this.enabled) {
      if (this.current) {
        this.current = null;
        this.updateIndicator();
      }
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      if (this.current) {
        this.current = null;
        this.updateIndicator();
      }
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();

    if (!selection || !selection.trim()) {
      if (this.current) {
        this.current = null;
        this.updateIndicator();
      }
      return;
    }

    const from = editor.getCursor("from");
    const lineCount = selection.split("\n").length;

    this.current = {
      notePath: view.file?.path ?? "",
      mode: "selection",
      selectedText: selection,
      lineCount,
      startLine: from.line + 1,
    };
    this.updateIndicator();
  }

  private updateIndicator(): void {
    if (!this.indicatorEl) {
      this.onContextChanged?.();
      return;
    }

    if (!this.current) {
      this.indicatorEl.empty();
      this.indicatorEl.style.display = "none";
      this.onContextChanged?.();
      return;
    }

    this.indicatorEl.style.display = "flex";
    this.indicatorEl.empty();

    const icon = this.indicatorEl.createSpan({ cls: "codexidian-context-icon", text: "📎" });
    const text = this.indicatorEl.createSpan({ cls: "codexidian-context-text" });
    const lines = this.current.lineCount;
    const preview = this.current.selectedText.slice(0, 60).replace(/\n/g, " ");
    const lineLabel = lines > 1 ? t("linePlural") : t("lineSingular");
    text.setText(tf("selectionPreview", {
      path: this.current.notePath,
      count: lines,
      lineLabel,
      preview,
    }));

    const clearBtn = this.indicatorEl.createSpan({ cls: "codexidian-context-clear", text: "✕" });
    clearBtn.addEventListener("click", () => {
      this.current = null;
      this.updateIndicator();
    });

    this.onContextChanged?.();
  }
}
