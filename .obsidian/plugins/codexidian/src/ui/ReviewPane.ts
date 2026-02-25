import { t } from "../i18n";
import type { DiffEntry, ReviewComment } from "../types";

interface ReviewPaneOptions {
  onCommentsChanged?: (comments: ReviewComment[]) => void;
}

export class ReviewPane {
  private readonly containerEl: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly countBadgeEl: HTMLElement;
  private readonly arrowEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly diffsEl: HTMLElement;
  private readonly commentsEl: HTMLElement;
  private readonly scopeInputEl: HTMLInputElement;
  private readonly commentInputEl: HTMLInputElement;
  private readonly addBtnEl: HTMLButtonElement;
  private readonly options: ReviewPaneOptions;

  private collapsed = false;
  private diffs: DiffEntry[] = [];
  private comments: ReviewComment[] = [];
  private selectedDiffPath: string | null = null;

  constructor(containerEl: HTMLElement, options: ReviewPaneOptions = {}) {
    this.options = options;
    this.containerEl = containerEl;
    this.containerEl.addClass("codexidian-review-pane");

    this.headerEl = this.containerEl.createDiv({ cls: "codexidian-review-header" });
    const headerLeftEl = this.headerEl.createDiv({ cls: "codexidian-review-header-left" });
    this.titleEl = headerLeftEl.createSpan({ cls: "codexidian-review-title" });
    this.countBadgeEl = headerLeftEl.createSpan({ cls: "codexidian-review-count" });
    this.arrowEl = this.headerEl.createSpan({ cls: "codexidian-review-arrow" });

    this.bodyEl = this.containerEl.createDiv({ cls: "codexidian-review-body" });
    this.diffsEl = this.bodyEl.createDiv({ cls: "codexidian-review-diffs" });
    this.commentsEl = this.bodyEl.createDiv({ cls: "codexidian-review-comments" });

    const addWrapEl = this.bodyEl.createDiv({ cls: "codexidian-review-add" });
    this.scopeInputEl = addWrapEl.createEl("input", {
      cls: "codexidian-review-scope-input",
      attr: { type: "text" },
    });
    this.commentInputEl = addWrapEl.createEl("input", {
      cls: "codexidian-review-comment-input",
      attr: { type: "text" },
    });
    this.addBtnEl = addWrapEl.createEl("button", { cls: "codexidian-review-add-btn" });
    this.addBtnEl.type = "button";

    this.headerEl.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.render();
    });
    this.addBtnEl.addEventListener("click", () => this.addCommentFromInputs());
    this.commentInputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.addCommentFromInputs();
    });

    this.render();
  }

  setDiffs(diffs: DiffEntry[]): void {
    const normalized: DiffEntry[] = [];
    const seen = new Set<string>();
    for (const entry of diffs) {
      const filePath = typeof entry?.filePath === "string" ? entry.filePath.trim() : "";
      if (!filePath) continue;
      const key = filePath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        filePath,
        status: entry.status,
        summary: entry.summary?.trim() || undefined,
      });
    }

    this.diffs = normalized;

    const stillSelected = this.selectedDiffPath
      ? this.diffs.some((entry) => entry.filePath === this.selectedDiffPath)
      : false;
    if (!stillSelected) {
      this.selectedDiffPath = this.diffs[0]?.filePath ?? null;
    }
    if (!this.scopeInputEl.value.trim() && this.selectedDiffPath) {
      this.scopeInputEl.value = this.selectedDiffPath;
    }

    this.render();
  }

  addComment(comment: ReviewComment): void {
    const text = comment.text.trim();
    if (!text) return;

    const normalized: ReviewComment = {
      id: comment.id?.trim() || this.generateCommentId(),
      scope: comment.scope.trim() || this.selectedDiffPath || "general",
      text,
      createdAt: Number.isFinite(comment.createdAt) ? comment.createdAt : Date.now(),
    };

    this.comments.push(normalized);
    this.notifyCommentsChanged();
    this.render();
  }

  removeComment(id: string): void {
    const next = this.comments.filter((comment) => comment.id !== id);
    if (next.length === this.comments.length) {
      return;
    }
    this.comments = next;
    this.notifyCommentsChanged();
    this.render();
  }

  getComments(): ReviewComment[] {
    return this.comments.map((comment) => ({ ...comment }));
  }

  clearComments(): void {
    if (this.comments.length === 0) {
      return;
    }
    this.comments = [];
    this.notifyCommentsChanged();
    this.render();
  }

  clear(): void {
    this.diffs = [];
    this.selectedDiffPath = null;
    this.scopeInputEl.value = "";
    this.commentInputEl.value = "";
    this.clearComments();
    this.render();
  }

  destroy(): void {
    this.containerEl.empty();
  }

  refreshLocale(): void {
    this.render();
  }

  private addCommentFromInputs(): void {
    const text = this.commentInputEl.value.trim();
    if (!text) {
      return;
    }

    const fallbackScope = this.selectedDiffPath || this.diffs[0]?.filePath || "general";
    const scope = this.scopeInputEl.value.trim() || fallbackScope;
    this.addComment({
      id: this.generateCommentId(),
      scope,
      text,
      createdAt: Date.now(),
    });
    this.commentInputEl.value = "";
    this.scopeInputEl.value = scope;
    this.commentInputEl.focus();
  }

  private notifyCommentsChanged(): void {
    try {
      this.options.onCommentsChanged?.(this.getComments());
    } catch {
      // Keep the pane usable even if external listeners fail.
    }
  }

  private render(): void {
    const visible = this.diffs.length > 0;
    this.containerEl.toggleClass("is-active", visible);
    this.containerEl.toggleClass("is-collapsed", this.collapsed);

    this.titleEl.setText(t("reviewTitle"));
    this.countBadgeEl.setText(String(this.comments.length));
    this.arrowEl.setText(this.collapsed ? "▸" : "▾");
    this.scopeInputEl.placeholder = t("reviewScopePlaceholder");
    this.commentInputEl.placeholder = t("reviewCommentPlaceholder");
    this.addBtnEl.setText(t("reviewAddComment"));

    if (!visible) {
      return;
    }

    this.renderDiffs();
    this.renderComments();
  }

  private renderDiffs(): void {
    this.diffsEl.empty();
    const titleEl = this.diffsEl.createDiv({ cls: "codexidian-review-section-title", text: t("reviewDiffsTitle") });
    titleEl.title = t("reviewDiffsTitle");

    for (const diff of this.diffs) {
      const itemEl = this.diffsEl.createDiv({
        cls: `codexidian-review-diff-item codexidian-review-diff-item--${diff.status}`,
      });
      if (diff.filePath === this.selectedDiffPath) {
        itemEl.addClass("is-selected");
      }

      itemEl.createSpan({
        cls: "codexidian-review-diff-icon",
        text: this.diffIcon(diff.status),
      });
      const pathEl = itemEl.createSpan({ cls: "codexidian-review-diff-path", text: diff.filePath });
      pathEl.title = diff.filePath;
      itemEl.createSpan({ cls: "codexidian-review-diff-status", text: this.diffStatusLabel(diff.status) });

      if (diff.summary) {
        const summaryEl = itemEl.createSpan({ cls: "codexidian-review-diff-summary", text: diff.summary });
        summaryEl.title = diff.summary;
      }

      itemEl.addEventListener("click", () => {
        this.selectedDiffPath = diff.filePath;
        this.scopeInputEl.value = diff.filePath;
        this.renderDiffs();
      });
    }
  }

  private renderComments(): void {
    this.commentsEl.empty();
    this.commentsEl.createDiv({ cls: "codexidian-review-section-title", text: t("reviewCommentsTitle") });

    if (this.comments.length === 0) {
      this.commentsEl.createDiv({ cls: "codexidian-review-comment-empty", text: t("reviewCommentsEmpty") });
      return;
    }

    for (const comment of this.comments) {
      const rowEl = this.commentsEl.createDiv({ cls: "codexidian-review-comment" });
      const scopeEl = rowEl.createSpan({ cls: "codexidian-review-comment-scope", text: comment.scope });
      scopeEl.title = comment.scope;
      const textEl = rowEl.createSpan({ cls: "codexidian-review-comment-text", text: comment.text });
      textEl.title = comment.text;
      const removeBtn = rowEl.createEl("button", {
        cls: "codexidian-review-comment-remove",
        text: t("reviewCommentRemove"),
      });
      removeBtn.type = "button";
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.removeComment(comment.id);
      });
    }
  }

  private diffIcon(status: DiffEntry["status"]): string {
    if (status === "added") return "+";
    if (status === "deleted") return "-";
    return "~";
  }

  private diffStatusLabel(status: DiffEntry["status"]): string {
    if (status === "added") return t("reviewStatusAdded");
    if (status === "deleted") return t("reviewStatusDeleted");
    return t("reviewStatusModified");
  }

  private generateCommentId(): string {
    return `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
