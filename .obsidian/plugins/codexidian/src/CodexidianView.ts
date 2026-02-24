import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";

import type CodexidianPlugin from "./main";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ConversationMeta,
  SlashCommand,
  TabManagerState,
  ToolCompleteInfo,
  ToolStartInfo,
  UserInputRequest,
  UserInputResponse,
} from "./types";
import { AVAILABLE_MODELS, EFFORT_OPTIONS, type ThinkingEffort } from "./types";
import { VaultFileAdapter } from "./storage/VaultFileAdapter";
import { SessionStorage } from "./storage/SessionStorage";
import { MessageRenderer } from "./rendering/MessageRenderer";
import {
  ThinkingBlockRenderer,
  type ThinkingBlockHandle,
} from "./rendering/ThinkingBlockRenderer";
import {
  ToolCallRenderer,
  type ToolCardHandle,
} from "./rendering/ToolCallRenderer";
import { ConversationController } from "./controllers/ConversationController";
import { SelectionController } from "./controllers/SelectionController";
import { TabBar } from "./tabs/TabBar";
import { TabManager, type Tab } from "./tabs/TabManager";
import { buildAugmentedPrompt } from "./utils/context";
import { FileContext } from "./ui/FileContext";
import { ImageContext } from "./ui/ImageContext";
import { SlashCommandMenu } from "./ui/SlashCommandMenu";
import { StatusPanel } from "./ui/StatusPanel";

export const VIEW_TYPE_CODEXIDIAN = "codexidian-view";

export class CodexidianView extends ItemView {
  private rootEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private messagesContainer!: HTMLElement;
  private contextRowEl!: HTMLElement;
  private noteContextEl!: HTMLElement;
  private noteContextTextEl!: HTMLElement;
  private noteContextToggleEl!: HTMLButtonElement;
  private selectionContextEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;
  private effortSelect!: HTMLSelectElement;
  private newThreadBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;
  private historyBtn!: HTMLButtonElement;
  private historyMenuEl!: HTMLElement;

  private vaultAdapter!: VaultFileAdapter;
  private sessionStorage!: SessionStorage;
  private messageRenderer!: MessageRenderer;
  private thinkingRenderer!: ThinkingBlockRenderer;
  private toolCallRenderer!: ToolCallRenderer;
  private selectionController!: SelectionController;
  private fileContext: FileContext | null = null;
  private imageContext: ImageContext | null = null;
  private slashMenu: SlashCommandMenu | null = null;
  private statusPanel: StatusPanel | null = null;
  private tabManager!: TabManager;
  private tabBar!: TabBar;

  private running = false;
  private historyOpen = false;
  private lastShortcutSendAt = 0;
  private messageQueue: string[] = [];
  private currentTurnId: string | null = null;
  private queueIndicatorEl: HTMLElement | null = null;
  private sendSequence = 0;
  private cancelledSendSequences = new Set<number>();
  private includeCurrentNoteContent = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CodexidianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CODEXIDIAN; }
  getDisplayText(): string { return "Codexidian"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    // Init storage
    this.vaultAdapter = new VaultFileAdapter(this.app);
    this.sessionStorage = new SessionStorage(this.vaultAdapter);
    let storageInitError: string | null = null;
    try {
      await this.sessionStorage.init();
    } catch (error) {
      storageInitError = error instanceof Error ? error.message : String(error);
      new Notice(`Codexidian: storage initialization failed (${storageInitError}). Continuing without persistence.`);
    }

    // Init renderer
    this.messageRenderer = new MessageRenderer(this.app, this);
    this.thinkingRenderer = new ThinkingBlockRenderer();
    this.toolCallRenderer = new ToolCallRenderer();

    // Build DOM
    this.rootEl = container.createDiv({ cls: "codexidian-view" });

    // Header
    const headerEl = this.rootEl.createDiv({ cls: "codexidian-header" });
    const headerLeft = headerEl.createDiv({ cls: "codexidian-header-left" });
    headerLeft.createDiv({ cls: "codexidian-title", text: "Codexidian" });
    this.statusEl = headerLeft.createDiv({ cls: "codexidian-status", text: "Disconnected" });

    // Tab bar container
    const tabBarContainer = headerEl.createDiv({ cls: "codexidian-tab-bar-container" });

    // Header right buttons
    const headerRight = headerEl.createDiv({ cls: "codexidian-header-right" });
    headerRight.style.position = "relative";
    this.historyBtn = headerRight.createEl("button", { text: "History" });
    this.newThreadBtn = headerRight.createEl("button", { text: "New Thread" });
    this.restartBtn = headerRight.createEl("button", { text: "Restart" });

    // History menu (hidden by default)
    this.historyMenuEl = headerRight.createDiv({ cls: "codexidian-history-menu" });
    this.historyMenuEl.style.display = "none";

    // Messages container (holds tab panels)
    this.messagesContainer = this.rootEl.createDiv({ cls: "codexidian-messages-container" });

    // Context row
    this.contextRowEl = this.rootEl.createDiv({ cls: "codexidian-context-row" });
    this.noteContextEl = this.contextRowEl.createDiv({ cls: "codexidian-note-context" });
    this.noteContextTextEl = this.noteContextEl.createSpan({ cls: "codexidian-note-context-text" });
    this.noteContextToggleEl = this.noteContextEl.createEl("button", {
      cls: "codexidian-note-context-toggle",
    });
    this.noteContextToggleEl.addEventListener("click", () => {
      this.includeCurrentNoteContent = !this.includeCurrentNoteContent;
      this.updateNoteContextToggle();
    });
    this.selectionContextEl = this.contextRowEl.createDiv({ cls: "codexidian-selection-context" });
    this.updateNoteContextToggle();

    const statusPanelEl = this.rootEl.createDiv({ cls: "codexidian-status-panel" });
    this.statusPanel = new StatusPanel(statusPanelEl);

    // Footer
    const footerEl = this.rootEl.createDiv({ cls: "codexidian-footer" });
    const fileChipContainerEl = footerEl.createDiv({ cls: "codexidian-file-chips-container" });
    const imagePreviewContainerEl = footerEl.createDiv({ cls: "codexidian-image-previews-container" });
    const inputWrapEl = footerEl.createDiv({ cls: "codexidian-input-wrap" });
    this.inputEl = inputWrapEl.createEl("textarea", { cls: "codexidian-input" });
    this.inputEl.placeholder = "Ask Codex about this vault...";
    this.slashMenu = new SlashCommandMenu(inputWrapEl);
    this.registerBuiltinSlashCommands();

    // Model + Effort toolbar
    const toolbarEl = footerEl.createDiv({ cls: "codexidian-toolbar" });

    const modelGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group" });
    modelGroup.createSpan({ cls: "codexidian-toolbar-label", text: "Model" });
    this.modelSelect = modelGroup.createEl("select", { cls: "codexidian-toolbar-select" });
    for (const m of AVAILABLE_MODELS) {
      const opt = this.modelSelect.createEl("option", { text: m.label, value: m.value });
      if (m.value === this.plugin.settings.model) opt.selected = true;
    }
    this.modelSelect.addEventListener("change", () => {
      this.plugin.settings.model = this.modelSelect.value;
      void this.plugin.saveSettings();
    });

    const effortGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group" });
    effortGroup.createSpan({ cls: "codexidian-toolbar-label", text: "Effort" });
    this.effortSelect = effortGroup.createEl("select", { cls: "codexidian-toolbar-select" });
    for (const e of EFFORT_OPTIONS) {
      const opt = this.effortSelect.createEl("option", { text: e.label, value: e.value });
      if (e.value === this.plugin.settings.thinkingEffort) opt.selected = true;
    }
    this.effortSelect.addEventListener("change", () => {
      this.plugin.settings.thinkingEffort = this.effortSelect.value as ThinkingEffort;
      void this.plugin.saveSettings();
    });

    const actionsEl = footerEl.createDiv({ cls: "codexidian-actions" });
    actionsEl.createDiv({ cls: "codexidian-hint", text: "Ctrl/Cmd+Enter to send" });
    this.sendBtn = actionsEl.createEl("button", { text: "Send" });
    this.queueIndicatorEl = footerEl.createDiv({ cls: "codexidian-queue-indicator" });
    this.updateQueueIndicator();

    // Init TabBar
    this.tabBar = new TabBar(tabBarContainer, {
      maxTabs: this.plugin.settings.maxTabs,
      onSelect: (tabId) => this.tabManager.switchTo(tabId),
      onClose: (tabId) => this.tabManager.closeTab(tabId),
      onAdd: () => this.createNewTab(),
    });

    // Init TabManager
    this.tabManager = new TabManager(
      this.tabBar,
      this.messagesContainer,
      () => new ConversationController(this.sessionStorage, this.messageRenderer),
      this.plugin.client,
      (tab) => this.onTabSwitched(tab),
    );

    // Init SelectionController
    this.selectionController = new SelectionController(this.app);
    this.selectionController.setEnabled(this.plugin.settings.enableSelectionPolling);
    this.selectionController.setOnContextChanged(() => this.updateContextRowVisibility());
    this.selectionController.start(this.selectionContextEl);

    try {
      this.fileContext = new FileContext(this.app, fileChipContainerEl, this.inputEl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Codexidian: failed to initialize file mention context (${message})`);
      this.fileContext = null;
    }
    try {
      this.imageContext = new ImageContext(imagePreviewContainerEl, this.inputEl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Codexidian: failed to initialize image paste context (${message})`);
      this.imageContext = null;
    }

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.refreshCurrentNoteContext();
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      this.refreshCurrentNoteContext();
    }));
    this.refreshCurrentNoteContext();

    await this.restoreTabsWithFallback();

    if (storageInitError) {
      const tab = this.tabManager.getActiveTab();
      if (tab) {
        this.appendSystemMessageToPanel(
          tab.panelEl,
          `Storage unavailable. Session will run without persistence. (${storageInitError})`,
        );
      }
    }

    this.bindEvents();
    this.updateStatus();
  }

  async onClose(): Promise<void> {
    try {
      const settings = this.plugin.settings as any;
      if (this.tabManager) {
        settings._tabManagerState = this.tabManager.getState();
      }
      await this.plugin.saveSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Codexidian: failed to persist tab state (${message})`);
    }

    this.selectionController?.stop();
    this.selectionController?.setOnContextChanged(null);
    this.fileContext?.destroy();
    this.fileContext = null;
    this.imageContext?.destroy();
    this.imageContext = null;
    this.slashMenu?.destroy();
    this.slashMenu = null;
    this.messageRenderer?.destroy();
    this.statusPanel?.destroy();
    this.statusPanel = null;
    this.tabManager?.destroy();
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener("click", () => void this.sendCurrentInput());
    this.inputEl.addEventListener("input", () => {
      this.handleSlashInputChanged();
    });

    // Capture phase improves reliability when Obsidian/global handlers also listen for keydown.
    this.inputEl.addEventListener("keydown", (e) => {
      if (this.slashMenu?.isVisible()) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          this.slashMenu.selectNext();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          this.slashMenu.selectPrev();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          void this.executeSelectedSlashCommand();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.slashMenu.hide();
          return;
        }
      }

      if (e.key === "Escape" && this.running) {
        e.preventDefault();
        e.stopPropagation();
        void this.cancelCurrentStream();
        return;
      }
      if (!this.isSubmitShortcut(e)) return;
      this.handleSubmitShortcut(e);
    }, true);

    // Scope-level fallback for cases where host keymap handling swallows textarea key events.
    try {
      this.scope?.register(["Mod"], "Enter", (e: KeyboardEvent) => {
        if (document.activeElement !== this.inputEl) {
          return true;
        }
        this.handleSubmitShortcut(e);
        return false;
      });
      this.scope?.register([], "Escape", () => {
        if (document.activeElement !== this.inputEl) {
          return true;
        }
        if (this.slashMenu?.isVisible()) {
          this.slashMenu.hide();
          return false;
        }
        if (!this.running) {
          return true;
        }
        void this.cancelCurrentStream();
        return false;
      });
    } catch {
      // Keep DOM listener path working even if scope registration fails.
    }

    this.newThreadBtn.addEventListener("click", () => void this.startNewThread());
    this.restartBtn.addEventListener("click", () => void this.restartEngine());
    this.historyBtn.addEventListener("click", () => this.toggleHistory());
  }

  private isSubmitShortcut(e: KeyboardEvent): boolean {
    const isMod = e.ctrlKey || e.metaKey;
    const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
    return isMod && isEnter;
  }

  private handleSubmitShortcut(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (this.inputEl.disabled) return;
    if (this.slashMenu?.isVisible()) {
      e.preventDefault();
      e.stopPropagation();
      void this.executeSelectedSlashCommand();
      return;
    }
    // Guard against duplicate dispatch when both DOM listener and Scope callback fire.
    const now = Date.now();
    if (now - this.lastShortcutSendAt < 80) return;
    this.lastShortcutSendAt = now;

    e.preventDefault();
    e.stopPropagation();
    void this.sendCurrentInput();
  }

  private registerBuiltinSlashCommands(): void {
    if (!this.slashMenu) return;

    const register = (command: SlashCommand): void => {
      this.slashMenu?.registerCommand({
        ...command,
        execute: async () => {
          this.inputEl.value = "";
          this.slashMenu?.hide();
          await command.execute();
          this.inputEl.focus();
        },
      });
    };

    register({
      name: "new",
      label: "New Chat",
      description: "Start a new conversation tab.",
      icon: "➕",
      execute: async () => {
        const tabCount = this.tabManager.getAllTabStates().length;
        if (tabCount >= this.plugin.settings.maxTabs) {
          new Notice(`Cannot create new tab: max tabs (${this.plugin.settings.maxTabs}) reached.`);
          return;
        }
        await this.createNewTab();
      },
    });

    register({
      name: "clear",
      label: "Clear Chat",
      description: "Clear messages in the current conversation.",
      icon: "🧹",
      execute: async () => {
        await this.clearCurrentConversationMessages();
      },
    });

    register({
      name: "model",
      label: "Cycle Model",
      description: "Switch to the next configured model.",
      icon: "🤖",
      execute: async () => {
        await this.cycleModelSetting();
      },
    });

    register({
      name: "effort",
      label: "Cycle Effort",
      description: "Cycle thinking effort (low → medium → high → xhigh).",
      icon: "🧠",
      execute: async () => {
        await this.cycleEffortSetting();
      },
    });

    register({
      name: "history",
      label: "Toggle History",
      description: "Open or close the conversation history menu.",
      icon: "🕘",
      execute: () => {
        this.toggleHistory();
      },
    });

    register({
      name: "tabs",
      label: "Show Tabs",
      description: "Show a summary of current tabs.",
      icon: "🗂",
      execute: () => {
        this.showTabsSummary();
      },
    });

    register({
      name: "help",
      label: "Show Help",
      description: "List all available slash commands.",
      icon: "❓",
      execute: () => {
        this.showSlashCommandHelp();
      },
    });
  }

  private handleSlashInputChanged(): void {
    if (!this.slashMenu) return;
    const value = this.inputEl.value;
    if (!value.startsWith("/")) {
      this.slashMenu.hide();
      return;
    }
    const filter = this.extractSlashFilter(value);
    this.slashMenu.show(filter);
  }

  private async executeSelectedSlashCommand(): Promise<void> {
    const executed = await this.slashMenu?.executeSelected();
    if (!executed) return;
    this.inputEl.value = "";
    this.inputEl.focus();
  }

  private async executeSlashCommandByName(name: string): Promise<boolean> {
    const executed = await this.slashMenu?.executeByName(name);
    if (!executed) return false;
    this.inputEl.value = "";
    this.slashMenu?.hide();
    this.inputEl.focus();
    return true;
  }

  private extractSlashFilter(value: string): string {
    if (!value.startsWith("/")) {
      return "";
    }
    const withoutPrefix = value.slice(1).trimStart();
    const [token] = withoutPrefix.split(/\s+/, 1);
    return (token ?? "").trim().toLowerCase();
  }

  private extractSlashCommandName(value: string): string | null {
    if (!value.startsWith("/")) {
      return null;
    }
    const name = this.extractSlashFilter(value);
    return name.length > 0 ? name : null;
  }

  private async clearCurrentConversationMessages(): Promise<void> {
    const tab = this.tabManager.getActiveTab();
    if (!tab) {
      new Notice("No active tab to clear.");
      return;
    }

    tab.panelEl.empty();
    tab.conversationController.setMessages([]);
    this.statusPanel?.clear();
    new Notice("Cleared current conversation messages.");
  }

  private async cycleModelSetting(): Promise<void> {
    const currentValue = this.plugin.settings.model;
    const currentIndex = AVAILABLE_MODELS.findIndex((model) => model.value === currentValue);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextModel = AVAILABLE_MODELS[(safeIndex + 1) % AVAILABLE_MODELS.length];

    this.plugin.settings.model = nextModel.value;
    this.modelSelect.value = nextModel.value;
    await this.plugin.saveSettings();
    this.updateStatus();
    new Notice(`Model set to ${nextModel.label}`);
  }

  private async cycleEffortSetting(): Promise<void> {
    const values = EFFORT_OPTIONS.map((option) => option.value);
    const currentValue = this.plugin.settings.thinkingEffort;
    const currentIndex = values.indexOf(currentValue);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextOption = EFFORT_OPTIONS[(safeIndex + 1) % EFFORT_OPTIONS.length];

    this.plugin.settings.thinkingEffort = nextOption.value as ThinkingEffort;
    this.effortSelect.value = nextOption.value;
    await this.plugin.saveSettings();
    this.updateStatus();
    new Notice(`Thinking effort set to ${nextOption.label}`);
  }

  private showTabsSummary(): void {
    const tabStates = this.tabManager.getAllTabStates();
    if (tabStates.length === 0) {
      this.appendSystemMessage("No tabs are currently open.");
      return;
    }

    const activeTabId = this.tabManager.getActiveTab()?.state.tabId ?? null;
    const summary = tabStates.map((state, index) => {
      const activeFlag = state.tabId === activeTabId ? "*" : "";
      const shortTabId = state.tabId.slice(-4);
      const conv = state.conversationId ? state.conversationId.slice(-6) : "none";
      return `${activeFlag}${index + 1}[${shortTabId}] conv:${conv}`;
    }).join(" | ");

    this.appendSystemMessage(`Tabs ${tabStates.length}/${this.plugin.settings.maxTabs}: ${summary}`);
  }

  private showSlashCommandHelp(): void {
    const commands = this.slashMenu?.getCommands() ?? [];
    if (commands.length === 0) {
      this.appendSystemMessage("No slash commands are registered.");
      return;
    }

    const helpText = commands
      .map((command) => `/${command.name}: ${command.description}`)
      .join(" | ");
    this.appendSystemMessage(`Available slash commands: ${helpText}`);
  }

  private updateQueueIndicator(): void {
    if (!this.queueIndicatorEl) return;
    const queued = this.messageQueue.length;
    if (queued <= 0) {
      this.queueIndicatorEl.removeClass("visible");
      this.queueIndicatorEl.setText("");
      return;
    }
    this.queueIndicatorEl.setText(`${queued} message${queued === 1 ? "" : "s"} queued`);
    this.queueIndicatorEl.addClass("visible");
  }

  private async cancelCurrentStream(): Promise<void> {
    if (!this.running) return;

    const activeSeq = this.sendSequence;
    this.cancelledSendSequences.add(activeSeq);

    const turnId = this.currentTurnId ?? this.plugin.client.getCurrentTurnId();
    this.currentTurnId = turnId;

    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab) {
      this.tabBar.setStreaming(activeTab.state.tabId, false);
      this.appendSystemMessageToPanel(activeTab.panelEl, "(Cancelled by user)");
    }

    this.running = false;
    this.updateStatus();
    this.statusPanel?.setTurnStatus("idle");
    this.statusPanel?.clearFinishedAfterDelay(3000);

    try {
      if (turnId) {
        await this.plugin.client.cancelTurn(turnId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (activeTab) {
        this.appendSystemMessageToPanel(activeTab.panelEl, `Cancel request failed: ${message}`);
      }
    } finally {
      this.currentTurnId = null;
    }

    try {
      await this.processQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Codexidian: failed to process queue (${message})`);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.running) return;
    const nextPrompt = this.messageQueue.shift();
    this.updateQueueIndicator();
    if (!nextPrompt) return;
    try {
      await this.sendCurrentInput(nextPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        this.appendSystemMessageToPanel(activeTab.panelEl, `Queued message failed: ${message}`);
      }
    }
  }

  private async createNewTab(): Promise<void> {
    const tab = this.tabManager.addTab();
    try {
      const conv = await tab.conversationController.createNew();
      this.tabManager.setConversationId(tab.state.tabId, conv.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessageToPanel(tab.panelEl, `Failed to initialize conversation: ${message}`);
    }
    this.appendSystemMessageToPanel(tab.panelEl, "Ready. Click Send to start Codex in this pane.");
  }

  private async restoreTabConversation(tab: Tab): Promise<void> {
    if (!tab.state.conversationId) return;
    const conv = await tab.conversationController.switchTo(tab.state.conversationId);
    if (!conv) return;

    await this.renderConversationMessages(tab.panelEl, conv.messages);

    // Restore thread
    if (conv.threadId) {
      this.plugin.client.setThreadId(conv.threadId);
    }
  }

  private onTabSwitched(tab: Tab): void {
    this.updateStatus();
    // Scroll to bottom of active panel
    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
  }

  private async sendCurrentInput(promptOverride?: string): Promise<void> {
    const rawPrompt = promptOverride ?? this.inputEl.value;
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const slashCommandName = this.extractSlashCommandName(prompt);
    if (slashCommandName) {
      const executed = await this.executeSlashCommandByName(slashCommandName);
      if (executed) {
        if (promptOverride === undefined) {
          this.inputEl.value = "";
        }
        return;
      }
    }

    if (this.running) {
      this.messageQueue.push(prompt);
      if (promptOverride === undefined) {
        this.inputEl.value = "";
      }
      this.updateQueueIndicator();
      return;
    }

    if (!this.tabManager) return;

    let tab = this.tabManager.getActiveTab();
    if (!tab) {
      await this.createNewTab();
      tab = this.tabManager.getActiveTab();
    }
    if (!tab) return;

    const cc = tab.conversationController;
    if (promptOverride === undefined) {
      this.inputEl.value = "";
    }

    // Build augmented prompt with context
    const notePath = this.getCurrentMarkdownNotePath();

    const editorCtx = this.plugin.settings.enableContextInjection
      ? (this.selectionController?.getContext() ?? null)
      : null;
    const attachedFiles = await this.collectAttachedFileContents(notePath, tab.panelEl);
    const imageAttachments = this.imageContext?.getImages() ?? [];
    const imageLines = imageAttachments.map((image) => (
      `(Image attached: ${image.name || "pasted-image"})`
    ));
    const promptWithImages = imageLines.length > 0
      ? `${prompt}\n\n${imageLines.join("\n")}`
      : prompt;
    const augmented = buildAugmentedPrompt(promptWithImages, notePath, editorCtx, attachedFiles);

    // Show user message (original text only)
    const userMessage = cc.addMessage("user", prompt);
    this.appendMessageToPanel(tab.panelEl, "user", prompt, userMessage.id);

    // Create assistant message element for streaming
    const assistantEl = this.createMessageEl(tab.panelEl, "assistant");
    let accumulated = "";
    const sendSeq = ++this.sendSequence;
    const toolCards = new Map<string, ToolCardHandle>();
    const runningToolIds = new Set<string>();
    let activeToolItemId: string | null = null;
    let fallbackToolIndex = 0;
    let thinkingBlock: ThinkingBlockHandle | null = null;
    let thinkingFinalized = false;
    const toolStartTimes = new Map<string, number>();
    let thinkingEntryId: string | null = null;
    let thinkingStartedAt = 0;

    const createTimelineSlot = (): HTMLElement => {
      const slotEl = tab.panelEl.createDiv();
      tab.panelEl.insertBefore(slotEl, assistantEl);
      return slotEl;
    };

    const finalizeThinking = (): void => {
      if (thinkingFinalized || !thinkingBlock) return;
      thinkingFinalized = true;
      thinkingBlock.finalize();
      if (thinkingEntryId) {
        this.statusPanel?.updateEntry(thinkingEntryId, {
          status: "completed",
          duration: Date.now() - thinkingStartedAt,
        });
        thinkingEntryId = null;
        thinkingStartedAt = 0;
      }
    };

    const ensureThinkingEntry = (): void => {
      if (thinkingEntryId) return;
      thinkingEntryId = `thinking-${sendSeq}`;
      thinkingStartedAt = Date.now();
      this.statusPanel?.addEntry({
        id: thinkingEntryId,
        type: "thinking",
        label: "Reasoning",
        status: "running",
      });
    };

    const ensureToolCard = (
      itemId: string,
      info?: Partial<ToolStartInfo> & { type?: string },
    ): ToolCardHandle => {
      const existing = toolCards.get(itemId);
      if (existing) return existing;
      const card = this.toolCallRenderer.createCard(createTimelineSlot(), {
        type: info?.type ?? "tool",
        name: info?.name,
        command: info?.command,
        filePath: info?.filePath,
      });
      toolCards.set(itemId, card);
      return card;
    };

    this.running = true;
    this.currentTurnId = null;
    this.updateStatus();
    this.statusPanel?.setTurnStatus("thinking");
    this.tabBar.setStreaming(tab.state.tabId, true);

    try {
      const turnPromise = this.plugin.client.sendTurn(
        augmented,
        {
          onDelta: (delta) => {
            if (!this.currentTurnId) {
              this.currentTurnId = this.plugin.client.getCurrentTurnId();
            }
            if (thinkingEntryId) {
              this.statusPanel?.updateEntry(thinkingEntryId, {
                status: "completed",
                duration: Date.now() - thinkingStartedAt,
              });
              thinkingEntryId = null;
              thinkingStartedAt = 0;
            }
            this.statusPanel?.setTurnStatus("streaming");
            accumulated += delta;
            this.messageRenderer.renderStreaming(assistantEl, accumulated);
            tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
          },
          onThinkingDelta: (delta) => {
            if (!delta) return;
            this.statusPanel?.setTurnStatus("thinking");
            ensureThinkingEntry();
            if (!thinkingBlock) {
              thinkingBlock = this.thinkingRenderer.createBlock(createTimelineSlot());
            }
            thinkingBlock.appendContent(delta);
            tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
          },
          onToolStart: (info: ToolStartInfo) => {
            const card = ensureToolCard(info.itemId, info);
            runningToolIds.add(info.itemId);
            activeToolItemId = info.itemId;
            card.complete("running");
            toolStartTimes.set(info.itemId, Date.now());
            this.statusPanel?.setTurnStatus("tool_calling");
            this.statusPanel?.addEntry({
              id: info.itemId,
              type: "tool_call",
              label: info.name || info.type || "Tool",
              detail: this.truncateStatusDetail(info.command || info.filePath),
              status: "running",
            });
            tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
          },
          onToolDelta: (delta) => {
            if (!this.currentTurnId) {
              this.currentTurnId = this.plugin.client.getCurrentTurnId();
            }
            this.statusPanel?.setTurnStatus("tool_calling");

            if (delta.length > 0) {
              let itemId = activeToolItemId;
              if (!itemId) {
                itemId = `tool-fallback-${sendSeq}-${++fallbackToolIndex}`;
                activeToolItemId = itemId;
                runningToolIds.add(itemId);
              }
              const card = ensureToolCard(itemId, { type: "tool", name: "Tool output" });
              card.appendOutput(delta);
            }

            if (delta.trim().length > 0) {
              this.statusEl.setText(`Tool: ${delta.trim().slice(0, 80)}`);
            }
          },
          onToolComplete: (info: ToolCompleteInfo) => {
            const card = ensureToolCard(info.itemId, info);
            card.complete(info.status);
            const startedAt = toolStartTimes.get(info.itemId);
            this.statusPanel?.updateEntry(info.itemId, {
              status: this.resolveEntryStatus(info.status),
              duration: startedAt ? Date.now() - startedAt : undefined,
            });
            runningToolIds.delete(info.itemId);
            if (activeToolItemId === info.itemId) {
              const remaining = Array.from(runningToolIds);
              activeToolItemId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
            tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
          },
          onSystem: (message) => {
            this.appendSystemMessageToPanel(tab.panelEl, message);
          },
        },
        {
          model: this.modelSelect.value || undefined,
          effort: this.effortSelect.value || undefined,
        },
      );
      const captureTurnId = () => {
        if (this.currentTurnId || !this.running || sendSeq !== this.sendSequence) {
          return;
        }
        const activeTurnId = this.plugin.client.getCurrentTurnId();
        if (activeTurnId) {
          this.currentTurnId = activeTurnId;
          return;
        }
        window.setTimeout(captureTurnId, 25);
      };
      captureTurnId();
      const result = await turnPromise;
      this.currentTurnId = result.turnId;
      this.statusPanel?.setTurnStatus("streaming");
      const cancelledByUser = this.cancelledSendSequences.has(sendSeq);

      // Final render
      if (accumulated.trim().length === 0) {
        if (cancelledByUser || result.status === "cancelled") {
          accumulated = "(Cancelled)";
        } else {
          accumulated = result.errorMessage || "(No assistant text output)";
        }
      }
      await this.messageRenderer.renderContent(assistantEl, accumulated);
      finalizeThinking();

      // Save thread ID to conversation
      if (result.threadId) {
        cc.setThreadId(result.threadId);
      }

      // Persist assistant message
      cc.addMessage("assistant", accumulated);

      if (result.status !== "completed" && !(cancelledByUser && result.status === "cancelled")) {
        const suffix = result.errorMessage ? `: ${result.errorMessage}` : "";
        this.appendSystemMessageToPanel(tab.panelEl, `Turn finished with status ${result.status}${suffix}`);
      }
    } catch (error) {
      const cancelledByUser = this.cancelledSendSequences.has(sendSeq);
      const message = error instanceof Error ? error.message : String(error);

      if (cancelledByUser) {
        const finalText = accumulated.trim().length > 0 ? accumulated : "(Cancelled)";
        await this.messageRenderer.renderContent(assistantEl, finalText);
        cc.addMessage("assistant", finalText);
        finalizeThinking();
      } else {
        await this.messageRenderer.renderContent(assistantEl, "(No assistant output)");
        this.appendSystemMessageToPanel(tab.panelEl, `Request failed: ${message}`);
        new Notice(`Codexidian: ${message}`);
        finalizeThinking();
      }
    } finally {
      finalizeThinking();
      this.cancelledSendSequences.delete(sendSeq);
      if (sendSeq !== this.sendSequence) {
        return;
      }

      this.running = false;
      this.currentTurnId = null;
      this.tabBar.setStreaming(tab.state.tabId, false);
      this.statusPanel?.setTurnStatus("idle");
      this.statusPanel?.clearFinishedAfterDelay(3000);
      this.updateStatus();
      try {
        this.fileContext?.clear();
        this.imageContext?.clear();
      } catch {
        // Keep message flow intact if context cleanup fails.
      }
      try {
        await this.processQueue();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Codexidian: failed to process queue (${message})`);
      }
    }
  }

  private async startNewThread(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.updateStatus();
    try {
      const threadId = await this.plugin.client.newThread();
      const tab = this.tabManager.getActiveTab();
      if (tab) {
        tab.conversationController.setThreadId(threadId);
        this.appendSystemMessageToPanel(tab.panelEl, `Started new thread: ${threadId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tab = this.tabManager.getActiveTab();
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, `Failed to start new thread: ${message}`);
      new Notice(`Codexidian: ${message}`);
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  private async restartEngine(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.updateStatus();
    try {
      await this.plugin.client.restart();
      const tab = this.tabManager.getActiveTab();
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, "Codex app-server restarted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tab = this.tabManager.getActiveTab();
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, `Restart failed: ${message}`);
      new Notice(`Codexidian: ${message}`);
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  private toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) {
      void this.renderHistoryMenu();
      this.historyMenuEl.style.display = "block";
    } else {
      this.historyMenuEl.style.display = "none";
    }
  }

  private async renderHistoryMenu(): Promise<void> {
    this.historyMenuEl.empty();
    const cc = this.tabManager.getActiveConversationController();
    if (!cc) return;

    const list = await cc.listConversations();
    if (list.length === 0) {
      this.historyMenuEl.createDiv({ cls: "codexidian-history-empty", text: "No conversations yet" });
      return;
    }

    for (const meta of list) {
      this.renderHistoryItem(meta);
    }
  }

  private renderHistoryItem(meta: ConversationMeta): void {
    const item = this.historyMenuEl.createDiv({ cls: "codexidian-history-item" });
    const titleEl = item.createSpan({ cls: "codexidian-history-title" });
    titleEl.setText(meta.title);
    titleEl.title = `${meta.messageCount} messages\n${meta.preview}`;

    const actions = item.createDiv({ cls: "codexidian-history-actions" });

    const openBtn = actions.createEl("button", { cls: "codexidian-history-action-btn", text: "Open" });
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.openConversation(meta.id);
      this.toggleHistory();
    });

    const deleteBtn = actions.createEl("button", { cls: "codexidian-history-action-btn delete", text: "Del" });
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.deleteConversation(meta.id);
    });

    item.addEventListener("click", () => {
      void this.openConversation(meta.id);
      this.toggleHistory();
    });
  }

  private async openConversation(id: string): Promise<void> {
    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    const conv = await tab.conversationController.switchTo(id);
    if (!conv) {
      new Notice("Failed to load conversation");
      return;
    }

    this.tabManager.setConversationId(tab.state.tabId, id);
    tab.panelEl.empty();

    await this.renderConversationMessages(tab.panelEl, conv.messages);

    if (conv.threadId) {
      this.plugin.client.setThreadId(conv.threadId);
    }

    this.updateStatus();
    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
  }

  private async deleteConversation(id: string): Promise<void> {
    const cc = this.tabManager.getActiveConversationController();
    if (!cc) return;
    await cc.deleteConversation(id);
    void this.renderHistoryMenu();
  }

  private async renderConversationMessages(panelEl: HTMLElement, messages: ChatMessage[]): Promise<void> {
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const el = this.createMessageEl(panelEl, "assistant", msg.id);
        await this.messageRenderer.renderContent(el, msg.content);
      } else {
        this.appendMessageToPanel(panelEl, msg.role, msg.content, msg.id);
      }
    }
  }

  // --- DOM helpers ---

  private createMessageEl(panelEl: HTMLElement, role: string, messageId?: string): HTMLElement {
    const wrapperEl = panelEl.createDiv({ cls: "codexidian-msg-wrapper" });
    wrapperEl.dataset.msgRole = role;
    if (messageId) {
      wrapperEl.dataset.msgId = messageId;
    }

    const messageEl = wrapperEl.createDiv({ cls: `codexidian-msg codexidian-msg-${role}` });
    if (role === "user" && messageId) {
      this.attachUserMessageActions(wrapperEl, messageId);
    }
    return messageEl;
  }

  private appendMessageToPanel(panelEl: HTMLElement, role: string, text: string, messageId?: string): HTMLElement {
    const el = this.createMessageEl(panelEl, role, messageId);
    el.setText(text);
    panelEl.scrollTop = panelEl.scrollHeight;
    return el;
  }

  private attachUserMessageActions(wrapperEl: HTMLElement, messageId: string): void {
    const actionsEl = wrapperEl.createDiv({ cls: "codexidian-msg-actions" });

    const rewindBtn = actionsEl.createEl("button", {
      cls: "codexidian-msg-action-btn",
      text: "↩",
      title: "Rewind to this message",
    });
    rewindBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.rewindToMessage(messageId);
    });

    const forkBtn = actionsEl.createEl("button", {
      cls: "codexidian-msg-action-btn",
      text: "⑂",
      title: "Fork from this message",
    });
    forkBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.forkFromMessage(messageId);
    });
  }

  private async rewindToMessage(messageId: string): Promise<void> {
    if (this.running) {
      new Notice("Cannot rewind while a turn is running.");
      return;
    }

    const confirmed = window.confirm("Rewind to this message? Messages after it will be removed.");
    if (!confirmed) {
      return;
    }

    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    try {
      const target = await tab.conversationController.truncateAfter(messageId);
      if (!target || target.role !== "user") {
        new Notice("Unable to rewind: message not found.");
        return;
      }

      this.removePanelContentFromMessage(tab.panelEl, messageId);
      this.inputEl.value = target.content;
      this.inputEl.focus();

      try {
        const threadId = await this.plugin.client.newThread();
        tab.conversationController.setThreadId(threadId);
        this.appendSystemMessageToPanel(tab.panelEl, "Rewind complete. Started a fresh thread.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendSystemMessageToPanel(tab.panelEl, `Rewind succeeded, but failed to start new thread: ${message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Rewind failed: ${message}`);
    } finally {
      this.updateStatus();
    }
  }

  private async forkFromMessage(messageId: string): Promise<void> {
    if (this.running) {
      new Notice("Cannot fork while a turn is running.");
      return;
    }

    const currentTabCount = this.tabManager.getAllTabStates().length;
    if (currentTabCount >= this.plugin.settings.maxTabs) {
      new Notice(`Cannot fork: max tabs (${this.plugin.settings.maxTabs}) reached.`);
      return;
    }

    const sourceTab = this.tabManager.getActiveTab();
    if (!sourceTab) return;

    try {
      const branchMessages = sourceTab.conversationController.getMessagesUpTo(messageId);
      if (branchMessages.length === 0) {
        new Notice("Unable to fork: message not found.");
        return;
      }

      const forkTab = this.tabManager.addTab();
      const forkConv = await forkTab.conversationController.createNew(`Fork ${new Date().toLocaleString()}`);
      this.tabManager.setConversationId(forkTab.state.tabId, forkConv.id);
      forkTab.conversationController.setMessages(branchMessages);

      forkTab.panelEl.empty();
      await this.renderConversationMessages(forkTab.panelEl, branchMessages);

      try {
        const threadId = await this.plugin.client.newThread();
        forkTab.conversationController.setThreadId(threadId);
        this.appendSystemMessageToPanel(forkTab.panelEl, "Fork created with a fresh thread.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendSystemMessageToPanel(forkTab.panelEl, `Fork created, but failed to start new thread: ${message}`);
      }

      this.tabManager.switchTo(forkTab.state.tabId);
      this.updateStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Fork failed: ${message}`);
    }
  }

  private removePanelContentFromMessage(panelEl: HTMLElement, messageId: string): void {
    const children = Array.from(panelEl.children);
    const startIndex = children.findIndex((child) => (
      child instanceof HTMLElement && child.dataset.msgId === messageId
    ));
    if (startIndex < 0) return;

    for (let index = children.length - 1; index >= startIndex; index--) {
      children[index].remove();
    }
    panelEl.scrollTop = panelEl.scrollHeight;
  }

  private appendSystemMessageToPanel(panelEl: HTMLElement, message: string): void {
    this.appendMessageToPanel(panelEl, "system", message);
  }

  appendSystemMessage(message: string): void {
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      this.appendSystemMessageToPanel(tab.panelEl, message);
    }
  }

  private async collectAttachedFileContents(
    notePath: string | null,
    panelEl: HTMLElement,
  ): Promise<Array<{ path: string; content: string }>> {
    const MAX_FILE_CHARS = 10_000;
    const requestedPaths = new Set<string>();

    for (const path of this.fileContext?.getFiles() ?? []) {
      requestedPaths.add(path);
    }
    if (this.includeCurrentNoteContent && notePath) {
      requestedPaths.add(notePath);
    }

    const fileContents: Array<{ path: string; content: string }> = [];
    for (const path of requestedPaths) {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof TFile)) {
        this.appendSystemMessageToPanel(panelEl, `Context file not found: ${path}`);
        continue;
      }

      try {
        let content = await this.app.vault.read(abstractFile);
        if (content.length > MAX_FILE_CHARS) {
          content = `${content.slice(0, MAX_FILE_CHARS)}\n\n...[truncated to ${MAX_FILE_CHARS} characters]`;
        }
        fileContents.push({ path, content });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendSystemMessageToPanel(panelEl, `Failed to read context file ${path}: ${message}`);
      }
    }

    return fileContents;
  }

  private refreshCurrentNoteContext(): void {
    const notePath = this.getCurrentMarkdownNotePath();

    if (!notePath) {
      this.noteContextEl.style.display = "none";
      this.noteContextTextEl.setText("");
      this.noteContextTextEl.title = "";
      this.updateContextRowVisibility();
      return;
    }

    this.noteContextEl.style.display = "flex";
    this.noteContextTextEl.setText(`📝 ${this.getFileName(notePath)}`);
    this.noteContextTextEl.title = notePath;
    this.updateContextRowVisibility();
  }

  private updateNoteContextToggle(): void {
    this.noteContextToggleEl.setText(this.includeCurrentNoteContent ? "Include note: on" : "Include note: off");
    if (this.includeCurrentNoteContent) {
      this.noteContextToggleEl.addClass("is-enabled");
    } else {
      this.noteContextToggleEl.removeClass("is-enabled");
    }
  }

  private updateContextRowVisibility(): void {
    const hasNote = this.noteContextEl.style.display !== "none";
    const hasSelection = this.selectionContextEl.style.display !== "none";
    this.contextRowEl.style.display = hasNote || hasSelection ? "flex" : "none";
  }

  private getFileName(path: string): string {
    const segments = path.split("/");
    return segments[segments.length - 1] || path;
  }

  private getCurrentMarkdownNotePath(): string | null {
    const activeMdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMdView?.file?.path) {
      return activeMdView.file.path;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path) {
        return view.file.path;
      }
    }

    return null;
  }

  async showApprovalCard(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.statusPanel?.setTurnStatus("waiting_approval");
    const tab = await this.ensureActiveTabForInlineCard();
    if (!tab) {
      this.restoreStatusAfterInteractiveCard();
      return "decline";
    }

    const statusEntryId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.statusPanel?.addEntry({
      id: statusEntryId,
      type: "info",
      label: this.getApprovalTitle(request.type),
      detail: this.truncateStatusDetail(request.command || request.filePath || request.cwd),
      status: "running",
    });

    const cardEl = tab.panelEl.createDiv({ cls: "codexidian-approval-card" });
    const headerEl = cardEl.createDiv({ cls: "codexidian-approval-header" });
    headerEl.createSpan({
      cls: "codexidian-approval-icon",
      text: request.type === "fileChange" || request.type === "applyPatch" ? "📝" : "⚡",
    });
    headerEl.createSpan({ text: this.getApprovalTitle(request.type) });

    const bodyEl = cardEl.createDiv({ cls: "codexidian-approval-body" });
    if (request.command) {
      bodyEl.createEl("code", { text: request.command });
    }
    if (request.filePath) {
      bodyEl.createDiv({ cls: "codexidian-approval-meta", text: `File: ${request.filePath}` });
    }
    if (request.cwd) {
      bodyEl.createDiv({ cls: "codexidian-approval-meta", text: `cwd: ${request.cwd}` });
    }
    if (!request.command && !request.filePath && request.params) {
      bodyEl.createEl("code", {
        text: JSON.stringify(request.params).slice(0, 800),
      });
    }

    const actionsEl = cardEl.createDiv({ cls: "codexidian-approval-actions" });
    const approveBtn = actionsEl.createEl("button", {
      cls: "codexidian-approval-btn approve",
      text: "Approve",
    });
    const denyBtn = actionsEl.createEl("button", {
      cls: "codexidian-approval-btn deny",
      text: "Deny",
    });
    const statusEl = cardEl.createDiv({ cls: "codexidian-approval-status" });

    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;

    return await new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        settle("decline", "Timed out (auto-denied)");
      }, 60_000);

      const settle = (decision: ApprovalDecision, statusText: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);

        approveBtn.disabled = true;
        denyBtn.disabled = true;
        cardEl.addClass("codexidian-approval-card-readonly");
        cardEl.addClass(decision === "accept" ? "codexidian-approval-accepted" : "codexidian-approval-denied");
        statusEl.setText(`Decision: ${statusText}`);
        this.statusPanel?.updateEntry(statusEntryId, {
          status: decision === "accept" ? "completed" : "failed",
        });
        this.restoreStatusAfterInteractiveCard();
        resolve(decision);
      };

      approveBtn.addEventListener("click", () => settle("accept", "Approved"));
      denyBtn.addEventListener("click", () => settle("decline", "Denied"));
    });
  }

  async showUserInputCard(request: UserInputRequest): Promise<UserInputResponse> {
    this.statusPanel?.setTurnStatus("waiting_approval");
    const tab = await this.ensureActiveTabForInlineCard();
    if (!tab) {
      this.restoreStatusAfterInteractiveCard();
      return this.buildDefaultUserInputResponse(request);
    }

    const statusEntryId = `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.statusPanel?.addEntry({
      id: statusEntryId,
      type: "info",
      label: "User input request",
      detail: this.truncateStatusDetail(request.questions.map((question) => question.id).join(", ")),
      status: "running",
    });

    const cardEl = tab.panelEl.createDiv({ cls: "codexidian-user-input-card" });
    const headerEl = cardEl.createDiv({ cls: "codexidian-user-input-header" });
    headerEl.createSpan({ text: "User Input Request" });

    const states = new Map<string, {
      selected: string | null;
      inputEl: HTMLInputElement;
      optionButtons: HTMLButtonElement[];
      firstOption: string;
    }>();

    for (const question of request.questions) {
      const questionEl = cardEl.createDiv({ cls: "codexidian-user-input-question" });
      questionEl.createDiv({
        cls: "codexidian-user-input-text",
        text: question.text || question.id,
      });

      const optionsEl = questionEl.createDiv({ cls: "codexidian-user-input-options" });
      const optionButtons: HTMLButtonElement[] = [];
      let firstOption = "";

      for (const option of question.options ?? []) {
        if (!firstOption) firstOption = option.label;
        const optionBtn = optionsEl.createEl("button", {
          cls: "codexidian-user-input-option",
          text: option.label,
        });
        optionButtons.push(optionBtn);
      }

      const inputEl = questionEl.createEl("input", {
        cls: "codexidian-user-input-freeform",
        type: "text",
        placeholder: "Or type a custom answer",
      });

      const state = { selected: null as string | null, inputEl, optionButtons, firstOption };
      states.set(question.id, state);

      for (const optionBtn of optionButtons) {
        optionBtn.addEventListener("click", () => {
          state.selected = optionBtn.textContent ?? "";
          for (const button of optionButtons) {
            if (button === optionBtn) {
              button.addClass("is-selected");
            } else {
              button.removeClass("is-selected");
            }
          }
        });
      }
    }

    const actionsEl = cardEl.createDiv({ cls: "codexidian-user-input-actions" });
    const submitBtn = actionsEl.createEl("button", {
      cls: "codexidian-user-input-submit",
      text: "Submit",
    });
    const statusEl = cardEl.createDiv({ cls: "codexidian-user-input-status" });

    const resolveResponse = (useDefaults: boolean): UserInputResponse => {
      if (useDefaults) {
        return this.buildDefaultUserInputResponse(request);
      }
      const answers: Record<string, { answers: string[] }> = {};
      for (const question of request.questions) {
        const state = states.get(question.id);
        const custom = state?.inputEl.value.trim() ?? "";
        const selected = state?.selected ?? "";
        const fallback = state?.firstOption ?? "";
        const answer = custom || selected || fallback;
        answers[question.id] = { answers: [answer] };
      }
      return { answers };
    };

    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;

    return await new Promise<UserInputResponse>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        settle(resolveResponse(true), "Timed out. Used default answers.");
      }, 60_000);

      const settle = (response: UserInputResponse, statusText: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);

        submitBtn.disabled = true;
        for (const state of states.values()) {
          state.inputEl.disabled = true;
          for (const button of state.optionButtons) {
            button.disabled = true;
          }
        }
        cardEl.addClass("codexidian-user-input-card-readonly");
        statusEl.setText(statusText);
        this.statusPanel?.updateEntry(statusEntryId, {
          status: statusText.startsWith("Timed out") ? "failed" : "completed",
        });
        this.restoreStatusAfterInteractiveCard();
        resolve(response);
      };

      submitBtn.addEventListener("click", () => {
        settle(resolveResponse(false), "Submitted");
      });
    });
  }

  updateStatus(): void {
    const settings = this.plugin.settings;
    const threadId = this.plugin.client.getThreadId();
    const runningText = this.running ? "Running" : "Idle";
    const threadText = threadId ? `thread ${threadId.slice(0, 8)}...` : "no thread";
    this.statusEl.setText(
      `${runningText} | ${threadText} | ${settings.model || "default"} | ${settings.thinkingEffort} | ${settings.approvalPolicy}`,
    );
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;
    this.newThreadBtn.disabled = this.running;
    this.restartBtn.disabled = this.running;
    this.updateQueueIndicator();
  }

  private isValidTabManagerState(state: unknown): state is TabManagerState {
    if (!state || typeof state !== "object") return false;
    const candidate = state as Partial<TabManagerState> & { openTabs?: unknown[] };
    if (!Array.isArray(candidate.openTabs)) return false;
    if (candidate.activeTabId !== null && candidate.activeTabId !== undefined && typeof candidate.activeTabId !== "string") {
      return false;
    }
    return candidate.openTabs.every((tab) => (
      tab
      && typeof tab === "object"
      && typeof (tab as any).tabId === "string"
      && (((tab as any).conversationId === null) || typeof (tab as any).conversationId === "string")
    ));
  }

  private async restoreTabsWithFallback(): Promise<void> {
    const savedState = (this.plugin.settings as any)._tabManagerState as unknown;
    const attemptedRestore = this.isValidTabManagerState(savedState);

    if (attemptedRestore) {
      try {
        await this.tabManager.restoreState(savedState);
        for (const tabState of this.tabManager.getAllTabStates()) {
          if (!tabState.conversationId) continue;
          const tab = this.tabManager.getTab(tabState.tabId);
          if (tab) {
            await this.restoreTabConversation(tab);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Codexidian: failed to restore tabs (${message}), creating a fresh tab.`);
      }
    }

    if (!this.tabManager.getActiveTab()) {
      const firstState = this.tabManager.getAllTabStates()[0];
      if (firstState) {
        this.tabManager.switchTo(firstState.tabId);
      }
    }

    if (!this.tabManager.getActiveTab()) {
      await this.createNewTab();
    }
  }

  private async ensureActiveTabForInlineCard(): Promise<Tab | null> {
    if (!this.tabManager) return null;

    let tab = this.tabManager.getActiveTab();
    if (!tab) {
      await this.createNewTab();
      tab = this.tabManager.getActiveTab();
    }
    return tab ?? null;
  }

  private buildDefaultUserInputResponse(request: UserInputRequest): UserInputResponse {
    const answers: Record<string, { answers: string[] }> = {};
    for (const question of request.questions) {
      const firstOption = question.options && question.options.length > 0 ? question.options[0].label : "";
      answers[question.id] = { answers: [firstOption] };
    }
    return { answers };
  }

  private getApprovalTitle(type: ApprovalRequest["type"]): string {
    if (type === "commandExecution" || type === "execCommand") {
      return "Command Execution Request";
    }
    if (type === "fileChange" || type === "applyPatch") {
      return "File Change Request";
    }
    return "Approval Request";
  }

  private resolveEntryStatus(status: string): "completed" | "failed" {
    const normalized = status.trim().toLowerCase();
    if (
      normalized.includes("error")
      || normalized.includes("fail")
      || normalized.includes("deny")
      || normalized.includes("reject")
      || normalized.includes("cancel")
      || normalized.includes("interrupt")
    ) {
      return "failed";
    }
    return "completed";
  }

  private truncateStatusDetail(value?: string): string | undefined {
    if (!value) return undefined;
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) return undefined;
    if (compact.length <= 80) return compact;
    return `${compact.slice(0, 80)}...`;
  }

  private restoreStatusAfterInteractiveCard(): void {
    if (!this.statusPanel) return;
    if (this.running) {
      this.statusPanel.setTurnStatus("tool_calling");
      return;
    }
    this.statusPanel.setTurnStatus("idle");
    this.statusPanel.clearFinishedAfterDelay(3000);
  }
}
