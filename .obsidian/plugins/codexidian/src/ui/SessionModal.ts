import { App, Modal, Notice } from "obsidian";

import { t, tf } from "../i18n";
import type { ConversationListFilter, ConversationMeta } from "../types";

interface SessionModalOptions {
  listConversations: (filter: ConversationListFilter) => Promise<ConversationMeta[]>;
  searchConversations: (query: string, filter: ConversationListFilter) => Promise<ConversationMeta[]>;
  onOpen: (conversation: ConversationMeta) => Promise<void> | void;
  onFork: (conversation: ConversationMeta) => Promise<void> | void;
  onTogglePin: (conversation: ConversationMeta, pinned: boolean) => Promise<void> | void;
  onToggleArchive: (conversation: ConversationMeta, archived: boolean) => Promise<void> | void;
  onDelete: (conversation: ConversationMeta) => Promise<void> | void;
}

const FILTERS: ConversationListFilter[] = ["all", "active", "archived", "pinned"];

export class SessionModal extends Modal {
  private readonly options: SessionModalOptions;
  private searchInputEl: HTMLInputElement | null = null;
  private filtersEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;

  private filter: ConversationListFilter = "active";
  private query = "";
  private sessions: ConversationMeta[] = [];
  private selectedIndex = 0;
  private busy = false;

  constructor(app: App, options: SessionModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.modalEl.addClass("codexidian-session-modal");
    this.contentEl.empty();

    this.contentEl.createEl("h2", {
      cls: "codexidian-session-title",
      text: t("sessionModalTitle"),
    });

    const searchWrapEl = this.contentEl.createDiv({ cls: "codexidian-session-search" });
    this.searchInputEl = searchWrapEl.createEl("input", {
      cls: "codexidian-session-search-input",
      attr: { type: "search" },
    });
    this.searchInputEl.placeholder = t("sessionSearchPlaceholder");
    this.searchInputEl.addEventListener("input", () => {
      this.query = this.searchInputEl?.value.trim() ?? "";
      void this.refreshSessions();
    });

    this.filtersEl = this.contentEl.createDiv({ cls: "codexidian-session-filters" });
    this.renderFilters();

    this.listEl = this.contentEl.createDiv({ cls: "codexidian-session-list" });
    this.emptyEl = this.contentEl.createDiv({
      cls: "codexidian-session-empty",
      text: t("sessionEmpty"),
    });

    this.contentEl.addEventListener("keydown", (event) => {
      this.handleKeyboardNavigation(event);
    });

    void this.refreshSessions();
    this.searchInputEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.sessions = [];
    this.searchInputEl = null;
    this.filtersEl = null;
    this.listEl = null;
    this.emptyEl = null;
  }

  private renderFilters(): void {
    if (!this.filtersEl) return;
    this.filtersEl.empty();

    for (const filter of FILTERS) {
      const btn = this.filtersEl.createEl("button", {
        cls: "codexidian-session-filter-btn",
        text: this.getFilterLabel(filter),
      });
      btn.type = "button";
      if (filter === this.filter) {
        btn.addClass("is-active");
      }
      btn.addEventListener("click", () => {
        if (this.busy || this.filter === filter) return;
        this.filter = filter;
        this.selectedIndex = 0;
        this.renderFilters();
        void this.refreshSessions();
      });
    }
  }

  private async refreshSessions(): Promise<void> {
    if (this.busy) return;

    this.setBusy(true);
    try {
      const sessions = this.query
        ? await this.options.searchConversations(this.query, this.filter)
        : await this.options.listConversations(this.filter);

      this.sessions = sessions
        .map((session) => ({
          ...session,
          tags: Array.isArray(session.tags) ? [...session.tags] : [],
        }))
        .sort((a, b) => {
          const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
          if (pinDelta !== 0) return pinDelta;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
      if (this.selectedIndex >= this.sessions.length) {
        this.selectedIndex = this.sessions.length > 0 ? this.sessions.length - 1 : 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("sessionLoadFailed", { error: message }));
      this.sessions = [];
      this.selectedIndex = 0;
    } finally {
      this.setBusy(false);
      this.renderList();
    }
  }

  private renderList(): void {
    if (!this.listEl || !this.emptyEl) return;
    this.listEl.empty();

    if (this.sessions.length === 0) {
      this.emptyEl.style.display = "block";
      return;
    }
    this.emptyEl.style.display = "none";

    this.sessions.forEach((session, index) => {
      const itemEl = this.listEl?.createDiv({ cls: "codexidian-session-item" });
      if (!itemEl) return;
      itemEl.dataset.index = String(index);
      if (index === this.selectedIndex) {
        itemEl.addClass("is-selected");
      }

      const infoEl = itemEl.createDiv({ cls: "codexidian-session-item-info" });
      const titleRowEl = infoEl.createDiv({ cls: "codexidian-session-item-title-row" });
      titleRowEl.createDiv({ cls: "codexidian-session-item-title", text: session.title });
      if (session.pinned) {
        titleRowEl.createSpan({ cls: "codexidian-session-item-pin", text: "PIN" });
      }
      if (session.archived) {
        titleRowEl.createSpan({ cls: "codexidian-session-item-archived", text: t("sessionArchivedBadge") });
      }

      const dateText = new Date(session.updatedAt || session.createdAt).toLocaleString();
      infoEl.createDiv({
        cls: "codexidian-session-item-meta",
        text: tf("sessionMetaLine", {
          date: dateText,
          count: session.messageCount,
        }),
      });

      if (session.tags && session.tags.length > 0) {
        const tagsEl = infoEl.createDiv({ cls: "codexidian-session-item-tags" });
        for (const tag of session.tags) {
          tagsEl.createSpan({ cls: "codexidian-session-item-tag", text: tag });
        }
      }

      const actionsEl = itemEl.createDiv({ cls: "codexidian-session-item-actions" });
      this.createActionButton(actionsEl, t("sessionOpen"), async () => {
        await this.options.onOpen(session);
        this.close();
      });
      this.createActionButton(actionsEl, t("sessionFork"), async () => {
        await this.options.onFork(session);
      });
      this.createActionButton(actionsEl, session.pinned ? t("sessionUnpin") : t("sessionPin"), async () => {
        await this.options.onTogglePin(session, !session.pinned);
      });
      this.createActionButton(
        actionsEl,
        session.archived ? t("sessionUnarchive") : t("sessionArchive"),
        async () => {
          await this.options.onToggleArchive(session, !session.archived);
        },
      );
      this.createActionButton(actionsEl, t("sessionDelete"), async () => {
        const confirmed = window.confirm(tf("sessionDeleteConfirm", { title: session.title }));
        if (!confirmed) return;
        await this.options.onDelete(session);
      }, "is-danger");

      itemEl.addEventListener("click", () => {
        this.selectedIndex = index;
        this.highlightSelection();
      });
      itemEl.addEventListener("dblclick", () => {
        if (this.busy) return;
        void this.runAction(async () => {
          await this.options.onOpen(session);
          this.close();
        });
      });
    });
  }

  private createActionButton(
    containerEl: HTMLElement,
    text: string,
    onClick: () => Promise<void>,
    extraCls?: string,
  ): void {
    const buttonEl = containerEl.createEl("button", {
      cls: `codexidian-session-action-btn${extraCls ? ` ${extraCls}` : ""}`,
      text,
    });
    buttonEl.type = "button";
    buttonEl.disabled = this.busy;
    buttonEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy) return;
      void this.runAction(onClick);
    });
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("sessionActionFailed", { error: message }));
    } finally {
      this.setBusy(false);
      if (this.listEl) {
        await this.refreshSessions();
      }
    }
  }

  private handleKeyboardNavigation(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (this.sessions.length === 0 || this.busy) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.sessions.length - 1);
      this.highlightSelection();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.highlightSelection();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = this.sessions[this.selectedIndex];
      if (!selected) return;
      void this.runAction(async () => {
        await this.options.onOpen(selected);
        this.close();
      });
    }
  }

  private highlightSelection(): void {
    if (!this.listEl) return;
    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".codexidian-session-item"));
    rows.forEach((row, index) => {
      if (index === this.selectedIndex) {
        row.addClass("is-selected");
        row.scrollIntoView({ block: "nearest" });
      } else {
        row.removeClass("is-selected");
      }
    });
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.modalEl.toggleClass("is-busy", busy);
  }

  private getFilterLabel(filter: ConversationListFilter): string {
    if (filter === "active") return t("sessionFilterActive");
    if (filter === "archived") return t("sessionFilterArchived");
    if (filter === "pinned") return t("sessionFilterPinned");
    return t("sessionFilterAll");
  }
}
