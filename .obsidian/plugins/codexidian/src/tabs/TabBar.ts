import type { TabState } from "../types";

export type TabBarCallback = (tabId: string) => void;

export class TabBar {
  private containerEl: HTMLElement;
  private tabs: TabState[] = [];
  private activeTabId: string | null = null;
  private maxTabs: number;

  private onSelect: TabBarCallback;
  private onClose: TabBarCallback;
  private onAdd: () => void;

  constructor(
    parentEl: HTMLElement,
    opts: {
      maxTabs: number;
      onSelect: TabBarCallback;
      onClose: TabBarCallback;
      onAdd: () => void;
    },
  ) {
    this.maxTabs = opts.maxTabs;
    this.onSelect = opts.onSelect;
    this.onClose = opts.onClose;
    this.onAdd = opts.onAdd;

    this.containerEl = parentEl.createDiv({ cls: "codexidian-tab-bar" });
  }

  update(tabs: TabState[], activeTabId: string | null): void {
    this.tabs = tabs;
    this.activeTabId = activeTabId;
    this.render();
  }

  setStreaming(tabId: string, streaming: boolean): void {
    const badge = this.containerEl.querySelector(`[data-tab-id="${tabId}"]`);
    if (badge) {
      badge.classList.toggle("codexidian-tab-badge-streaming", streaming);
    }
  }

  private render(): void {
    this.containerEl.empty();

    this.tabs.forEach((tab, index) => {
      const badge = this.containerEl.createDiv({ cls: "codexidian-tab-badge" });
      badge.dataset.tabId = tab.tabId;
      badge.setText(String(index + 1));
      badge.setAttribute("aria-label", `Tab ${index + 1}`);

      if (tab.tabId === this.activeTabId) {
        badge.classList.add("codexidian-tab-badge-active");
      }

      badge.addEventListener("click", () => this.onSelect(tab.tabId));
      badge.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (this.tabs.length > 1) {
          this.onClose(tab.tabId);
        }
      });
    });

    // "+" button if under max
    if (this.tabs.length < this.maxTabs) {
      const addBtn = this.containerEl.createDiv({ cls: "codexidian-tab-add" });
      addBtn.setText("+");
      addBtn.setAttribute("aria-label", "New Tab");
      addBtn.addEventListener("click", () => this.onAdd());
    }
  }
}
