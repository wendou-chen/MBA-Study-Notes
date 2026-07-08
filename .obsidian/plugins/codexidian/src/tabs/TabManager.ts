import type { TabState, TabManagerState } from "../types";
import { generateTabId } from "../types";
import type { TabBar } from "./TabBar";
import type { ConversationController } from "../controllers/ConversationController";
import type { CodexAppServerClient } from "../CodexAppServerClient";

export interface Tab {
  state: TabState;
  panelEl: HTMLElement;
  conversationController: ConversationController;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private activeTabId: string | null = null;

  constructor(
    private readonly tabBar: TabBar,
    private readonly messagesContainer: HTMLElement,
    private readonly createConversationController: () => ConversationController,
    private readonly client: CodexAppServerClient,
    private readonly onTabSwitch: (tab: Tab) => void,
  ) {}

  getActiveTab(): Tab | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) ?? null;
  }

  getTab(tabId: string): Tab | null {
    return this.tabs.get(tabId) ?? null;
  }

  getActiveConversationController(): ConversationController | null {
    return this.getActiveTab()?.conversationController ?? null;
  }

  getAllTabStates(): TabState[] {
    return Array.from(this.tabs.values()).map((t) => t.state);
  }

  addTab(conversationId: string | null = null, tabId?: string): Tab {
    const requestedId = typeof tabId === "string" ? tabId.trim() : "";
    const resolvedTabId = requestedId && !this.tabs.has(requestedId) ? requestedId : generateTabId();
    const panelEl = this.messagesContainer.createDiv({ cls: "codexidian-tab-panel" });
    panelEl.style.display = "none";

    const tab: Tab = {
      state: { tabId: resolvedTabId, conversationId },
      panelEl,
      conversationController: this.createConversationController(),
    };

    this.tabs.set(resolvedTabId, tab);
    this.switchTo(resolvedTabId);
    this.updateTabBar();
    return tab;
  }

  switchTo(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Hide all panels
    for (const t of this.tabs.values()) {
      t.panelEl.style.display = "none";
    }

    // Show target panel
    tab.panelEl.style.display = "flex";
    this.activeTabId = tabId;

    // Sync Codex thread
    const threadId = tab.conversationController.getActiveThreadId();
    this.client.setThreadId(threadId ?? null);

    this.updateTabBar();
    this.onTabSwitch(tab);
  }

  closeTab(tabId: string): void {
    if (this.tabs.size <= 1) return;

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.conversationController.destroy();
    tab.panelEl.remove();
    this.tabs.delete(tabId);

    // If closing active tab, switch to first remaining
    if (this.activeTabId === tabId) {
      const firstId = this.tabs.keys().next().value;
      if (firstId) this.switchTo(firstId);
    }

    this.updateTabBar();
  }

  setConversationId(tabId: string, conversationId: string | null): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.state.conversationId = conversationId;
    }
  }

  getState(): TabManagerState {
    return {
      openTabs: this.getAllTabStates(),
      activeTabId: this.activeTabId,
    };
  }

  async restoreState(state: TabManagerState): Promise<void> {
    const openTabs = Array.isArray(state?.openTabs) ? state.openTabs : [];
    if (!openTabs.length) {
      this.addTab();
      return;
    }

    for (const tabState of openTabs) {
      if (!tabState || typeof tabState.tabId !== "string") {
        continue;
      }
      const conversationId = typeof tabState.conversationId === "string" ? tabState.conversationId : null;
      this.addTab(conversationId, tabState.tabId);
    }

    if (this.tabs.size === 0) {
      this.addTab();
      return;
    }

    if (state.activeTabId && this.tabs.has(state.activeTabId)) {
      this.switchTo(state.activeTabId);
    } else {
      const firstId = this.tabs.keys().next().value as string | undefined;
      if (firstId) {
        this.switchTo(firstId);
      }
    }

    this.updateTabBar();
  }

  private updateTabBar(): void {
    this.tabBar.update(this.getAllTabStates(), this.activeTabId);
  }

  destroy(): void {
    for (const tab of this.tabs.values()) {
      tab.conversationController.destroy();
    }
    this.tabs.clear();
  }
}
