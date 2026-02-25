import { ItemView, MarkdownView, Menu, normalizePath, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";

import type CodexidianPlugin from "./main";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ConversationMeta,
  ConversationListFilter,
  DiffEntry,
  PlanStep,
  PlanUpdate,
  ReviewComment,
  SlashCommand,
  TabManagerState,
  ToolCompleteInfo,
  ToolStartInfo,
  UserInputRequest,
  UserInputResponse,
} from "./types";
import {
  APPROVAL_MODES,
  AVAILABLE_MODELS,
  EFFORT_OPTIONS,
  type ApprovalMode,
  type SkillPreset,
  type ThinkingEffort,
} from "./types";
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
import { PlanCardRenderer } from "./rendering/PlanCardRenderer";
import { ConversationController } from "./controllers/ConversationController";
import { SelectionController } from "./controllers/SelectionController";
import { TabBar } from "./tabs/TabBar";
import { TabManager, type Tab } from "./tabs/TabManager";
import { buildAugmentedPrompt } from "./utils/context";
import { FileContext } from "./ui/FileContext";
import { ImageContext } from "./ui/ImageContext";
import { SlashCommandMenu } from "./ui/SlashCommandMenu";
import { StatusPanel } from "./ui/StatusPanel";
import { ReviewPane } from "./ui/ReviewPane";
import { SessionModal } from "./ui/SessionModal";
import { PathValidator } from "./security/PathValidator";
import { t, tf } from "./i18n";

export const VIEW_TYPE_CODEXIDIAN = "codexidian-view";

interface ReviewTabState {
  diffs: DiffEntry[];
  comments: ReviewComment[];
}

export class CodexidianView extends ItemView {
  private rootEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private messagesContainer!: HTMLElement;
  private contextRowEl!: HTMLElement;
  private noteContextEl!: HTMLElement;
  private noteContextTextEl!: HTMLElement;
  private noteContextToggleEl!: HTMLButtonElement;
  private selectionContextEl!: HTMLElement;
  private attachBtn: HTMLButtonElement | null = null;
  private imageFileInputEl: HTMLInputElement | null = null;
  private dropZoneEl: HTMLElement | null = null;
  private dropZoneTextEl: HTMLElement | null = null;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;
  private effortSelect!: HTMLSelectElement;
  private skillMenuBtn!: HTMLButtonElement;
  private modeMenuBtn!: HTMLButtonElement;
  private newThreadBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;
  private historyBtn!: HTMLButtonElement;

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
  private reviewPane: ReviewPane | null = null;
  private tabManager!: TabManager;
  private tabBar!: TabBar;

  private running = false;
  private messageQueue: string[] = [];
  private currentTurnId: string | null = null;
  private queueIndicatorEl: HTMLElement | null = null;
  private modelLabelEl: HTMLElement | null = null;
  private effortLabelEl: HTMLElement | null = null;
  private skillLabelEl: HTMLElement | null = null;
  private modeLabelEl: HTMLElement | null = null;
  private sendSequence = 0;
  private cancelledSendSequences = new Set<number>();
  private includeCurrentNoteContent = false;
  private availableSkills: string[] = [];
  private reviewStateByTabId = new Map<string, ReviewTabState>();
  private planStateByTabId = new Map<string, PlanUpdate | null>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CodexidianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CODEXIDIAN; }
  getDisplayText(): string { return t("appTitle"); }
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
      new Notice(tf("noticeStorageInitFailed", { error: storageInitError }));
    }

    // Init renderer
    this.messageRenderer = new MessageRenderer(this.app, this, async (request) => {
      await this.applyCodeToNote(request.code, request.language, request.triggerEl);
    });
    this.thinkingRenderer = new ThinkingBlockRenderer();
    this.toolCallRenderer = new ToolCallRenderer();

    // Build DOM
    this.rootEl = container.createDiv({ cls: "codexidian-view" });

    // Header
    const headerEl = this.rootEl.createDiv({ cls: "codexidian-header" });
    const headerLeft = headerEl.createDiv({ cls: "codexidian-header-left" });
    this.titleEl = headerLeft.createDiv({ cls: "codexidian-title", text: t("appTitle") });
    this.statusEl = headerLeft.createDiv({ cls: "codexidian-status", text: t("disconnected") });

    // Tab bar container
    const tabBarContainer = headerEl.createDiv({ cls: "codexidian-tab-bar-container" });

    // Header right buttons
    const headerRight = headerEl.createDiv({ cls: "codexidian-header-right" });
    this.historyBtn = headerRight.createEl("button", { cls: "codexidian-header-icon-btn" });
    this.newThreadBtn = headerRight.createEl("button", { cls: "codexidian-header-icon-btn" });
    this.restartBtn = headerRight.createEl("button", { cls: "codexidian-header-icon-btn" });
    this.historyBtn.type = "button";
    this.newThreadBtn.type = "button";
    this.restartBtn.type = "button";
    this.updateHeaderButtons();

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
    if (this.plugin.settings.enableReviewPane) {
      const reviewPaneEl = this.rootEl.createDiv({ cls: "codexidian-review-pane-host" });
      this.reviewPane = new ReviewPane(reviewPaneEl, {
        onCommentsChanged: (comments) => this.handleReviewCommentsChanged(comments),
      });
    }

    // Footer
    const footerEl = this.rootEl.createDiv({ cls: "codexidian-footer" });
    const fileChipContainerEl = footerEl.createDiv({ cls: "codexidian-file-chips-container" });
    const imagePreviewContainerEl = footerEl.createDiv({ cls: "codexidian-image-previews-container" });
    const inputWrapEl = footerEl.createDiv({ cls: "codexidian-input-wrapper" });
    this.inputEl = inputWrapEl.createEl("textarea", { cls: "codexidian-input" });
    this.inputEl.placeholder = t("askPlaceholder");
    this.slashMenu = new SlashCommandMenu(inputWrapEl);
    this.registerBuiltinSlashCommands();

    this.imageFileInputEl = footerEl.createEl("input", {
      cls: "codexidian-attach-file-input",
      attr: { type: "file" },
    });
    this.imageFileInputEl.accept = "image/*";
    this.imageFileInputEl.multiple = true;

    // Model + Effort toolbar
    const toolbarEl = footerEl.createDiv({ cls: "codexidian-toolbar" });

    const modelGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group" });
    this.modelLabelEl = modelGroup.createSpan({ cls: "codexidian-toolbar-label", text: t("model") });
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
    this.effortLabelEl = effortGroup.createSpan({ cls: "codexidian-toolbar-label", text: t("effort") });
    this.effortSelect = effortGroup.createEl("select", { cls: "codexidian-toolbar-select" });
    for (const e of EFFORT_OPTIONS) {
      const opt = this.effortSelect.createEl("option", { text: e.label, value: e.value });
      if (e.value === this.plugin.settings.thinkingEffort) opt.selected = true;
    }
    this.effortSelect.addEventListener("change", () => {
      this.plugin.settings.thinkingEffort = this.effortSelect.value as ThinkingEffort;
      void this.plugin.saveSettings();
    });

    const skillGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group" });
    this.skillLabelEl = skillGroup.createSpan({ cls: "codexidian-toolbar-label", text: t("skill") });
    this.skillMenuBtn = skillGroup.createEl("button", {
      cls: "codexidian-toolbar-select codexidian-toolbar-menu-btn",
      text: this.getSkillPresetLabel(this.plugin.settings.skillPreset),
    });
    this.skillMenuBtn.type = "button";
    this.skillMenuBtn.addEventListener("click", (event) => {
      void this.openSkillMenu(event);
    });

    const attachGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group codexidian-toolbar-attach-group" });
    this.attachBtn = attachGroup.createEl("button", {
      cls: "codexidian-attach-btn",
      text: "📁",
    });
    this.attachBtn.type = "button";
    this.attachBtn.setAttr("aria-label", t("attachImage"));
    this.attachBtn.setAttr("title", t("attachImage"));

    const modeGroup = toolbarEl.createDiv({ cls: "codexidian-toolbar-group" });
    this.modeLabelEl = modeGroup.createSpan({ cls: "codexidian-toolbar-label", text: t("mode") });
    this.modeMenuBtn = modeGroup.createEl("button", {
      cls: "codexidian-toolbar-select codexidian-toolbar-menu-btn",
      text: this.getApprovalModeLabel(this.plugin.settings.approvalMode),
    });
    this.modeMenuBtn.type = "button";
    this.modeMenuBtn.addEventListener("click", (event) => {
      this.openApprovalModeMenu(event);
    });

    toolbarEl.createDiv({ cls: "codexidian-toolbar-spacer" });
    this.sendBtn = toolbarEl.createEl("button", { cls: "codexidian-send-btn" });
    this.sendBtn.type = "button";
    this.updateSendButton();

    this.queueIndicatorEl = footerEl.createDiv({ cls: "codexidian-queue-indicator" });
    this.updateQueueIndicator();
    this.dropZoneEl = this.rootEl.createDiv({ cls: "codexidian-drop-zone" });
    this.dropZoneTextEl = this.dropZoneEl.createDiv({
      cls: "codexidian-drop-zone-text",
      text: t("dropImagesHere"),
    });

    // Init TabBar
    this.tabBar = new TabBar(tabBarContainer, {
      maxTabs: this.plugin.settings.maxTabs,
      onSelect: (tabId) => this.tabManager.switchTo(tabId),
      onClose: (tabId) => this.closeTabWithReviewState(tabId),
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
      new Notice(tf("noticeFileContextInitFailed", { error: message }));
      this.fileContext = null;
    }
    try {
      this.imageContext = new ImageContext(imagePreviewContainerEl, this.inputEl, {
        dropTargetEl: this.rootEl,
        onDropZoneActiveChange: (active) => this.setDropZoneActive(active),
        onLimitReached: (max) => new Notice(tf("noticeAttachmentLimitReached", { max })),
        onFilesIgnored: () => new Notice(t("noticeImageOnlyAttachments")),
        onReadFailure: () => new Notice(t("noticeImageReadFailed")),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeImageContextInitFailed", { error: message }));
      this.imageContext = null;
    }

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.refreshCurrentNoteContext();
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      this.refreshCurrentNoteContext();
    }));
    this.refreshCurrentNoteContext();

    try {
      await this.restoreTabsWithFallback();
      this.ensureReviewStateForAllTabs();
      this.ensurePlanStateForAllTabs();
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        await this.ensureConversationReady(activeTab);
        this.applyReviewStateToPane(activeTab.state.tabId);
        this.renderPlanCardForTab(activeTab.state.tabId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeRestoreTabsFailed", { error: message }));
      if (!this.tabManager.getActiveTab()) {
        await this.createNewTab();
      }
    }

    if (storageInitError) {
      const tab = this.tabManager.getActiveTab();
      if (tab) {
        this.appendSystemMessageToPanel(
          tab.panelEl,
          tf("noticeStorageInitFailed", { error: storageInitError }),
        );
      }
    }

    try {
      await this.refreshAvailableSkills();
    } catch (error) {
      this.debugError("onOpen:refreshAvailableSkills", error);
    }
    this.updateSkillButtonText();
    this.updateModeButtonText();
    this.autoResizeInput();

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
      new Notice(tf("noticePersistTabStateFailed", { error: message }));
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
    this.reviewPane?.destroy();
    this.reviewPane = null;
    this.reviewStateByTabId.clear();
    this.planStateByTabId.clear();
    this.tabManager?.destroy();
    this.setDropZoneActive(false);
    this.dropZoneTextEl = null;
    this.dropZoneEl = null;
    this.attachBtn = null;
    this.imageFileInputEl = null;
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener("click", () => {
      void this.sendCurrentInput().catch((error) => this.handleUnhandledSendError(error));
    });
    this.attachBtn?.addEventListener("click", () => {
      this.imageFileInputEl?.click();
    });
    this.imageFileInputEl?.addEventListener("change", () => {
      const files = this.imageFileInputEl?.files;
      if (!files || files.length === 0) {
        return;
      }
      void this.handleImageFileSelection(files);
      if (this.imageFileInputEl) {
        this.imageFileInputEl.value = "";
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.autoResizeInput();
      this.handleSlashInputChanged();
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
        this.debugLog("Enter pressed", {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          isComposing: e.isComposing,
          slashMenuVisible: this.slashMenu?.isVisible() || false,
          running: this.running,
          inputDisabled: this.inputEl.disabled,
        });
      }

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

      const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
      if (isEnter && !e.shiftKey && !e.isComposing) {
        if (e.ctrlKey || e.metaKey) {
          console.log("[CODEXIDIAN DEBUG] Ctrl+Enter captured in input keydown");
        }
        e.preventDefault();
        e.stopPropagation();
        void this.sendCurrentInput().catch((error) => this.handleUnhandledSendError(error));
      }
    });

    this.newThreadBtn.addEventListener("click", () => void this.startNewThread());
    this.restartBtn.addEventListener("click", () => void this.restartEngine());
    this.historyBtn.addEventListener("click", () => this.openSessionModal());
  }

  private async handleImageFileSelection(files: FileList): Promise<void> {
    try {
      await this.imageContext?.addFiles(files);
      this.inputEl.focus();
    } catch (error) {
      this.debugError("handleImageFileSelection", error);
      new Notice(t("noticeImageReadFailed"));
    }
  }

  private setDropZoneActive(active: boolean): void {
    if (!this.dropZoneEl) {
      return;
    }
    if (active) {
      this.dropZoneEl.addClass("is-active");
    } else {
      this.dropZoneEl.removeClass("is-active");
    }
  }

  private registerBuiltinSlashCommands(): void {
    if (!this.slashMenu) return;

    const register = (command: SlashCommand): void => {
      this.slashMenu?.registerCommand({
        ...command,
        execute: async () => {
          this.setInputValue("");
          this.slashMenu?.hide();
          await command.execute();
          this.inputEl.focus();
        },
      });
    };

    register({
      name: "new",
      label: t("cmdNewLabel"),
      description: t("cmdNewDesc"),
      icon: "➕",
      execute: async () => {
        const tabCount = this.tabManager.getAllTabStates().length;
        if (tabCount >= this.plugin.settings.maxTabs) {
          new Notice(tf("noticeCannotCreateTabMax", { max: this.plugin.settings.maxTabs }));
          return;
        }
        await this.createNewTab();
      },
    });

    register({
      name: "clear",
      label: t("cmdClearLabel"),
      description: t("cmdClearDesc"),
      icon: "🧹",
      execute: async () => {
        await this.clearCurrentConversationMessages();
      },
    });

    register({
      name: "model",
      label: t("cmdModelLabel"),
      description: t("cmdModelDesc"),
      icon: "🤖",
      execute: async () => {
        await this.cycleModelSetting();
      },
    });

    register({
      name: "effort",
      label: t("cmdEffortLabel"),
      description: t("cmdEffortDesc"),
      icon: "🧠",
      execute: async () => {
        await this.cycleEffortSetting();
      },
    });

    register({
      name: "history",
      label: t("cmdHistoryLabel"),
      description: t("cmdHistoryDesc"),
      icon: "🕘",
      execute: () => {
        this.openSessionModal();
      },
    });

    register({
      name: "tabs",
      label: t("cmdTabsLabel"),
      description: t("cmdTabsDesc"),
      icon: "🗂",
      execute: () => {
        this.showTabsSummary();
      },
    });

    register({
      name: "help",
      label: t("cmdHelpLabel"),
      description: t("cmdHelpDesc"),
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
    this.setInputValue("");
    this.inputEl.focus();
  }

  private async executeSlashCommandByName(name: string): Promise<boolean> {
    const executed = await this.slashMenu?.executeByName(name);
    if (!executed) return false;
    this.setInputValue("");
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
      new Notice(t("noticeNoActiveTabToClear"));
      return;
    }

    const ready = await this.ensureConversationReady(tab);
    if (!ready) {
      return;
    }

    tab.panelEl.empty();
    tab.conversationController.setMessages([]);
    this.statusPanel?.clear();
    this.setReviewStateForTab(tab.state.tabId, []);
    this.setPlanForTab(tab.state.tabId, null);
    this.reviewPane?.clearComments();
    new Notice(t("noticeClearedConversation"));
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
    new Notice(tf("noticeModelSet", { model: nextModel.label }));
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
    new Notice(tf("noticeEffortSet", { effort: nextOption.label }));
  }

  private async refreshAvailableSkills(): Promise<void> {
    try {
      this.availableSkills = await this.plugin.refreshAvailableSkills();
    } catch {
      this.availableSkills = this.plugin.getAvailableSkills();
    }
  }

  private getSkillPresetLabel(value: SkillPreset): string {
    const normalized = value.trim();
    if (!normalized || normalized === "none") {
      return t("skillPresetNone");
    }
    return normalized;
  }

  private getApprovalModeLabel(value: ApprovalMode): string {
    const found = APPROVAL_MODES.find((mode) => mode.value === value);
    return found?.label ?? "Prompt";
  }

  private updateSkillButtonText(): void {
    if (!this.skillMenuBtn) return;
    const label = this.getSkillPresetLabel(this.plugin.settings.skillPreset);
    this.skillMenuBtn.setText(label);
    this.skillMenuBtn.setAttribute("aria-label", `${t("skill")}: ${label}`);
  }

  private updateModeButtonText(): void {
    if (!this.modeMenuBtn) return;
    const label = this.getApprovalModeLabel(this.plugin.settings.approvalMode);
    this.modeMenuBtn.setText(label);
    this.modeMenuBtn.setAttribute("aria-label", `${t("mode")}: ${label}`);
  }

  private async openSkillMenu(event: MouseEvent): Promise<void> {
    await this.refreshAvailableSkills();
    const menu = new Menu();
    const options: string[] = ["none", ...this.availableSkills];
    if (
      this.plugin.settings.skillPreset !== "none"
      && this.plugin.settings.skillPreset.trim().length > 0
      && !options.includes(this.plugin.settings.skillPreset)
    ) {
      options.push(this.plugin.settings.skillPreset);
    }

    for (const preset of options) {
      const label = this.getSkillPresetLabel(preset);
      menu.addItem((item) => {
        item.setTitle(label);
        if (this.plugin.settings.skillPreset === preset) {
          item.setChecked(true);
        }
        item.onClick(() => {
          this.plugin.settings.skillPreset = preset;
          this.updateSkillButtonText();
          void this.plugin.saveSettings();
          new Notice(tf("noticeSkillSet", { skill: label }));
        });
      });
    }
    menu.showAtMouseEvent(event);
  }

  private openApprovalModeMenu(event: MouseEvent): void {
    const menu = new Menu();
    for (const mode of APPROVAL_MODES) {
      const label = `${mode.label} (${mode.description})`;
      menu.addItem((item) => {
        item.setTitle(label);
        if (this.plugin.settings.approvalMode === mode.value) {
          item.setChecked(true);
        }
        item.onClick(() => {
          this.plugin.settings.approvalMode = mode.value;
          this.updateModeButtonText();
          void this.plugin.saveSettings();
          new Notice(tf("noticeCollaborationModeSet", { mode: mode.label }));
        });
      });
    }
    menu.showAtMouseEvent(event);
  }

  private showTabsSummary(): void {
    const tabStates = this.tabManager.getAllTabStates();
    if (tabStates.length === 0) {
      this.appendSystemMessage(t("messageNoTabsOpen"));
      return;
    }

    const activeTabId = this.tabManager.getActiveTab()?.state.tabId ?? null;
    const summary = tabStates.map((state, index) => {
      const activeFlag = state.tabId === activeTabId ? "*" : "";
      const shortTabId = state.tabId.slice(-4);
      const conv = state.conversationId ? state.conversationId.slice(-6) : "none";
      return `${activeFlag}${index + 1}[${shortTabId}] conv:${conv}`;
    }).join(" | ");

    this.appendSystemMessage(tf("messageTabsSummary", {
      count: tabStates.length,
      max: this.plugin.settings.maxTabs,
      summary,
    }));
  }

  private showSlashCommandHelp(): void {
    const commands = this.slashMenu?.getCommands() ?? [];
    if (commands.length === 0) {
      this.appendSystemMessage(t("messageNoSlashCommands"));
      return;
    }

    const helpText = commands
      .map((command) => `/${command.name}: ${command.description}`)
      .join(" | ");
    this.appendSystemMessage(tf("messageAvailableSlashCommands", { list: helpText }));
  }

  private updateQueueIndicator(): void {
    if (!this.queueIndicatorEl) return;
    const queued = this.messageQueue.length;
    if (queued <= 0) {
      this.queueIndicatorEl.removeClass("visible");
      this.queueIndicatorEl.setText("");
      return;
    }
    this.queueIndicatorEl.setText(queued === 1
      ? tf("messageQueuedCount", { count: queued })
      : tf("messageQueuedCountPlural", { count: queued }));
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
      this.appendSystemMessageToPanel(activeTab.panelEl, t("messageCancelledByUser"));
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
        this.appendSystemMessageToPanel(activeTab.panelEl, tf("messageCancelRequestFailed", { error: message }));
      }
    } finally {
      this.currentTurnId = null;
    }

    try {
      await this.processQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeProcessQueueFailed", { error: message }));
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
        this.appendSystemMessageToPanel(activeTab.panelEl, tf("messageQueuedSendFailed", { error: message }));
      }
    }
  }

  private closeTabWithReviewState(tabId: string): void {
    this.tabManager.closeTab(tabId);
    this.reviewStateByTabId.delete(tabId);
    this.planStateByTabId.delete(tabId);
    const activeTabId = this.tabManager.getActiveTab()?.state.tabId;
    if (activeTabId) {
      this.applyReviewStateToPane(activeTabId);
      this.renderPlanCardForTab(activeTabId);
    } else {
      this.reviewPane?.clear();
    }
  }

  private ensureReviewStateForAllTabs(): void {
    for (const state of this.tabManager.getAllTabStates()) {
      this.ensureReviewState(state.tabId);
    }
  }

  private ensurePlanStateForAllTabs(): void {
    for (const state of this.tabManager.getAllTabStates()) {
      this.ensurePlanState(state.tabId);
    }
  }

  private ensureReviewState(tabId: string): ReviewTabState {
    const existing = this.reviewStateByTabId.get(tabId);
    if (existing) {
      return existing;
    }
    const created: ReviewTabState = { diffs: [], comments: [] };
    this.reviewStateByTabId.set(tabId, created);
    return created;
  }

  private ensurePlanState(tabId: string): PlanUpdate | null {
    if (this.planStateByTabId.has(tabId)) {
      return this.planStateByTabId.get(tabId) ?? null;
    }
    this.planStateByTabId.set(tabId, null);
    return null;
  }

  private applyReviewStateToPane(tabId: string): void {
    const state = this.ensureReviewState(tabId);
    if (!this.reviewPane) {
      return;
    }
    const comments = state.comments.map((comment) => ({ ...comment }));
    this.reviewPane.setDiffs(state.diffs);
    this.reviewPane.clearComments();
    for (const comment of comments) {
      this.reviewPane.addComment(comment);
    }
  }

  private setReviewStateForTab(tabId: string, diffs: DiffEntry[]): void {
    const state = this.ensureReviewState(tabId);
    state.diffs = diffs.map((entry) => ({ ...entry }));
    if (this.tabManager.getActiveTab()?.state.tabId === tabId) {
      this.reviewPane?.setDiffs(state.diffs);
    }
  }

  private handleReviewCommentsChanged(comments: ReviewComment[]): void {
    const tab = this.tabManager.getActiveTab();
    if (!tab) {
      return;
    }
    const state = this.ensureReviewState(tab.state.tabId);
    state.comments = comments.map((comment) => ({ ...comment }));
  }

  private consumeReviewCommentsForActiveTab(): ReviewComment[] {
    const tab = this.tabManager.getActiveTab();
    if (!tab) {
      return [];
    }
    const state = this.ensureReviewState(tab.state.tabId);
    const comments = state.comments.map((comment) => ({ ...comment }));
    state.comments = [];
    if (this.reviewPane && tab.state.tabId === this.tabManager.getActiveTab()?.state.tabId) {
      this.reviewPane.clearComments();
    }
    return comments;
  }

  private setPlanForTab(tabId: string, plan: PlanUpdate | null): void {
    this.planStateByTabId.set(tabId, plan ? this.clonePlan(plan) : null);
    this.renderPlanCardForTab(tabId);
  }

  private getPlanForTab(tabId: string): PlanUpdate | null {
    return this.planStateByTabId.get(tabId) ?? null;
  }

  private clonePlan(plan: PlanUpdate): PlanUpdate {
    return {
      ...plan,
      steps: plan.steps.map((step) => ({ ...step })),
    };
  }

  private getOrCreatePlanCardHost(panelEl: HTMLElement): HTMLElement {
    const existing = panelEl.querySelector<HTMLElement>(".codexidian-plan-card-host");
    if (existing) {
      return existing;
    }
    return panelEl.createDiv({ cls: "codexidian-plan-card-host" });
  }

  private renderPlanCardForTab(tabId: string): void {
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return;

    const hostEl = this.getOrCreatePlanCardHost(tab.panelEl);
    const plan = this.getPlanForTab(tabId);
    if (!plan) {
      hostEl.empty();
      hostEl.remove();
      return;
    }

    PlanCardRenderer.render(hostEl, plan, {
      onApproveAll: async () => {
        await this.handlePlanApproveAll(tabId);
      },
      onGiveFeedback: async () => {
        await this.handlePlanFeedback(tabId);
      },
      onExecuteNext: async () => {
        await this.handlePlanExecuteNext(tabId);
      },
    });
  }

  private updatePlanForTab(tabId: string, updater: (plan: PlanUpdate) => void): void {
    const current = this.getPlanForTab(tabId);
    if (!current) return;
    const next = this.clonePlan(current);
    updater(next);
    this.setPlanForTab(tabId, next);
  }

  private async handlePlanApproveAll(tabId: string): Promise<void> {
    this.updatePlanForTab(tabId, (plan) => {
      plan.status = "approved";
      for (const step of plan.steps) {
        if (step.status === "pending") {
          step.status = "approved";
        }
      }
    });

    try {
      await this.sendCurrentInput(t("planApprovedProceedMessage"));
    } catch (error) {
      this.debugError("handlePlanApproveAll", error, { tabId });
    }
  }

  private async handlePlanFeedback(tabId: string): Promise<void> {
    const feedback = window.prompt(t("planFeedbackPrompt"), "");
    if (feedback === null) return;
    const trimmed = feedback.trim();
    if (!trimmed) return;

    const text = `${t("planFeedbackMessagePrefix")}:\n${trimmed}`;
    try {
      await this.sendCurrentInput(text);
    } catch (error) {
      this.debugError("handlePlanFeedback", error, { tabId });
    }
  }

  private async handlePlanExecuteNext(tabId: string): Promise<void> {
    const plan = this.getPlanForTab(tabId);
    if (!plan) return;

    const nextStep = plan.steps.find((step) => step.status === "approved" || step.status === "pending");
    if (!nextStep) return;

    this.updatePlanForTab(tabId, (draft) => {
      const target = draft.steps.find((step) => step.id === nextStep.id);
      if (!target) return;
      target.status = "executing";
      if (draft.status !== "completed") {
        draft.status = "in_progress";
      }
    });

    try {
      await this.sendCurrentInput(tf("planExecuteStepMessage", {
        index: nextStep.index,
        description: nextStep.description,
      }));

      this.updatePlanForTab(tabId, (draft) => {
        const target = draft.steps.find((step) => step.id === nextStep.id);
        if (!target) return;
        target.status = "completed";
        const hasRemaining = draft.steps.some((step) => (
          step.status === "approved" || step.status === "pending" || step.status === "executing"
        ));
        draft.status = hasRemaining ? "in_progress" : "completed";
      });
    } catch (error) {
      this.debugError("handlePlanExecuteNext", error, { tabId, stepId: nextStep.id });
      this.updatePlanForTab(tabId, (draft) => {
        const target = draft.steps.find((step) => step.id === nextStep.id);
        if (!target) return;
        target.status = "failed";
      });
    }
  }

  private async createNewTab(): Promise<void> {
    const tab = this.tabManager.addTab();
    this.ensureReviewState(tab.state.tabId);
    this.ensurePlanState(tab.state.tabId);
    try {
      const conv = await tab.conversationController.createNew();
      this.tabManager.setConversationId(tab.state.tabId, conv.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessageToPanel(tab.panelEl, tf("messageFailedInitConversation", { error: message }));
    }
    this.appendSystemMessageToPanel(tab.panelEl, t("messageReadyHint"));
  }

  private async restoreTabConversation(tab: Tab): Promise<void> {
    if (!tab.state.conversationId) {
      await this.ensureConversationReady(tab);
      return;
    }

    try {
      const conv = await tab.conversationController.switchTo(tab.state.conversationId);
      if (!conv) {
        this.tabManager.setConversationId(tab.state.tabId, null);
        await this.ensureConversationReady(tab);
        return;
      }

      await this.renderConversationMessages(tab.panelEl, conv.messages);

      // Restore thread
      if (conv.threadId) {
        this.plugin.client.setThreadId(conv.threadId);
      }
    } catch {
      this.tabManager.setConversationId(tab.state.tabId, null);
      await this.ensureConversationReady(tab);
    }
  }

  private onTabSwitched(tab: Tab): void {
    this.ensureReviewState(tab.state.tabId);
    this.applyReviewStateToPane(tab.state.tabId);
    this.ensurePlanState(tab.state.tabId);
    this.renderPlanCardForTab(tab.state.tabId);
    this.updateStatus();
    // Scroll to bottom of active panel
    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
  }

  private async ensureConversationReady(tab: Tab): Promise<boolean> {
    const active = tab.conversationController.getActive();
    if (active) {
      if (!tab.state.conversationId || tab.state.conversationId !== active.id) {
        this.tabManager.setConversationId(tab.state.tabId, active.id);
      }
      return true;
    }

    try {
      const conv = await tab.conversationController.createNew();
      this.tabManager.setConversationId(tab.state.tabId, conv.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessageToPanel(tab.panelEl, tf("messageFailedInitConversation", { error: message }));
      new Notice(tf("noticeCodexError", { error: message }));
      return false;
    }
  }

  private handleUnhandledSendError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.debugError("handleUnhandledSendError", error);
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      this.appendSystemMessageToPanel(tab.panelEl, tf("messageRequestFailed", { error: message }));
    }
    new Notice(tf("noticeCodexError", { error: message }));
    this.running = false;
    this.currentTurnId = null;
    this.statusPanel?.setTurnStatus("idle");
    this.statusPanel?.clearFinishedAfterDelay(3000);
    this.updateStatus();
  }

  private async sendCurrentInput(promptOverride?: string): Promise<void> {
    this.debugLog("sendCurrentInput:entry", {
      hasOverride: promptOverride !== undefined,
      running: this.running,
      queueLength: this.messageQueue.length,
    });
    const rawPrompt = promptOverride ?? this.inputEl.value;
    const prompt = rawPrompt.trim();
    if (!prompt) {
      this.debugLog("sendCurrentInput:skip-empty");
      return;
    }

    const slashCommandName = this.extractSlashCommandName(prompt);
    if (slashCommandName) {
      const executed = await this.executeSlashCommandByName(slashCommandName);
      if (executed) {
        this.debugLog("sendCurrentInput:slash-executed", { slashCommandName });
        if (promptOverride === undefined) {
          this.setInputValue("");
        }
        return;
      }
    }

    if (this.running) {
      this.messageQueue.push(prompt);
      this.debugLog("sendCurrentInput:queued", {
        queueLength: this.messageQueue.length,
      });
      if (promptOverride === undefined) {
        this.setInputValue("");
      }
      this.updateQueueIndicator();
      return;
    }

    if (!this.tabManager) return;

    let tab = this.tabManager.getActiveTab();
    if (!tab) {
      this.debugLog("sendCurrentInput:no-active-tab, creating");
      await this.createNewTab();
      tab = this.tabManager.getActiveTab();
    }
    if (!tab) {
      this.debugLog("sendCurrentInput:abort-no-tab");
      return;
    }

    const conversationReady = await this.ensureConversationReady(tab);
    if (!conversationReady) {
      this.debugLog("sendCurrentInput:abort-conversation-not-ready");
      return;
    }

    const cc = tab.conversationController;
    if (promptOverride === undefined) {
      this.setInputValue("");
    }

    // Build augmented prompt with context
    let notePath: string | null = null;
    try {
      notePath = this.getCurrentMarkdownNotePath();
    } catch (error) {
      this.debugError("sendCurrentInput:notePath-failed", error);
    }

    let editorCtx = null;
    try {
      editorCtx = this.plugin.settings.enableContextInjection
        ? (this.selectionController?.getContext() ?? null)
        : null;
    } catch (error) {
      this.debugError("sendCurrentInput:editorCtx-failed", error);
      editorCtx = null;
    }

    let attachedFiles: Array<{ path: string; content: string }> = [];
    try {
      attachedFiles = await this.collectAttachedFileContents(notePath, tab.panelEl);
    } catch (error) {
      this.debugError("sendCurrentInput:collectAttachedFileContents-failed", error);
      attachedFiles = [];
    }

    const existingPaths = new Set(attachedFiles.map((file) => file.path));
    let mcpContextFiles: Array<{ path: string; content: string }> = [];
    try {
      mcpContextFiles = await this.plugin.collectMcpContextForPrompt(prompt, notePath, existingPaths);
    } catch (error) {
      this.debugError("sendCurrentInput:mcpContext-failed", error);
      mcpContextFiles = [];
    }

    const allContextFiles = [...attachedFiles];
    if (mcpContextFiles.length > 0) {
      for (const file of mcpContextFiles) {
        if (existingPaths.has(file.path)) continue;
        existingPaths.add(file.path);
        allContextFiles.push(file);
      }
      try {
        this.appendSystemMessageToPanel(
          tab.panelEl,
          tf("messageMcpContextAttached", { paths: mcpContextFiles.map((file) => file.path).join(", ") }),
        );
      } catch (error) {
        this.debugError("sendCurrentInput:mcpContext-notice-failed", error);
      }
    }

    let imageAttachments: Array<{ name: string; dataUrl: string; path?: string }> = [];
    try {
      imageAttachments = this.imageContext?.getImages() ?? [];
    } catch (error) {
      this.debugError("sendCurrentInput:imageContext-failed", error);
      imageAttachments = [];
    }
    const imageInputs = imageAttachments
      .map((image) => ({
        name: image.name,
        dataUrl: typeof image.dataUrl === "string" ? image.dataUrl.trim() : "",
        path: typeof image.path === "string" ? image.path.trim() : "",
      }))
      .filter((image) => image.dataUrl.length > 0 || image.path.length > 0);
    const reviewComments = this.consumeReviewCommentsForActiveTab();
    const promptWithTurnControls = this.buildPromptWithTurnControls(prompt);
    const promptWithReviewComments = this.appendReviewCommentsToPrompt(promptWithTurnControls, reviewComments);
    let augmented = promptWithReviewComments;
    try {
      augmented = buildAugmentedPrompt(promptWithReviewComments, notePath, editorCtx, allContextFiles);
    } catch (error) {
      this.debugError("sendCurrentInput:buildAugmentedPrompt-failed", error);
      augmented = promptWithReviewComments;
    }

    this.debugLog("sendCurrentInput:prompt-ready", {
      promptLength: prompt.length,
      promptWithControlsLength: promptWithTurnControls.length,
      promptWithReviewCommentsLength: promptWithReviewComments.length,
      augmentedLength: augmented.length,
      attachedFiles: attachedFiles.length,
      mcpContextFiles: mcpContextFiles.length,
      imageAttachments: imageAttachments.length,
      reviewComments: reviewComments.length,
      skillPreset: this.plugin.settings.skillPreset,
      approvalMode: this.plugin.settings.approvalMode,
      notePath,
    });
    if (imageInputs.length > 0) {
      const firstImage = imageInputs[0];
      this.debugLog("sendCurrentInput:image payload", {
        count: imageInputs.length,
        firstImageHasPath: firstImage.path.length > 0,
        firstImagePath: firstImage.path.length > 0 ? firstImage.path : null,
        firstImageUrlPrefix: firstImage.dataUrl.slice(0, 50),
        firstImageUrlLength: firstImage.dataUrl.length,
      });
    }

    // Show user message (original text + image thumbnails, when present)
    let assistantEl: HTMLElement;
    try {
      const userImages = imageInputs.length > 0
        ? imageInputs.map((image) => ({ name: image.name, dataUrl: image.dataUrl }))
        : undefined;
      const userMessage = cc.addMessage("user", prompt, { images: userImages });
      this.appendMessageToPanel(tab.panelEl, "user", prompt, userMessage.id, userMessage.images);
      // Create assistant message element for streaming
      assistantEl = this.createMessageEl(tab.panelEl, "assistant");
    } catch (error) {
      this.debugError("sendCurrentInput:pre-send-render-failed", error);
      throw error;
    }
    let accumulated = "";
    const sendSeq = ++this.sendSequence;
    const toolCards = new Map<string, ToolCardHandle>();
    const runningToolIds = new Set<string>();
    let activeToolItemId: string | null = null;
    let fallbackToolIndex = 0;
    let thinkingBlock: ThinkingBlockHandle | null = null;
    let thinkingFinalized = false;
    const toolStartTimes = new Map<string, number>();
    const toolMetadataById = new Map<string, Partial<ToolStartInfo>>();
    const toolOutputById = new Map<string, string>();
    const turnDiffsByPath = new Map<string, DiffEntry>();
    let detectedPlanFromTool: PlanUpdate | null = null;
    let thinkingEntryId: string | null = null;
    let thinkingStartedAt = 0;

    const createTimelineSlot = (): HTMLElement => {
      const slotEl = tab.panelEl.createDiv();
      const assistantWrapperEl = assistantEl.closest(".codexidian-msg-wrapper");
      const referenceEl = assistantWrapperEl instanceof HTMLElement
        ? assistantWrapperEl
        : assistantEl;
      if (referenceEl.parentElement === tab.panelEl) {
        tab.panelEl.insertBefore(slotEl, referenceEl);
      }
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
        label: t("reasoning"),
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
      this.debugLog("sendCurrentInput:before-sendTurn", {
        sendSeq,
        tabId: tab.state.tabId,
        model: this.modelSelect.value || "(default)",
        effort: this.effortSelect.value || "(default)",
        imageInputs: imageInputs.length,
      });
      const turnPromise = this.plugin.client.sendTurn(
        augmented,
        {
          onDelta: (delta) => {
            this.debugLog("sendCurrentInput:onDelta", {
              sendSeq,
              deltaLength: delta.length,
            });
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
            this.debugLog("sendCurrentInput:onThinkingDelta", {
              sendSeq,
              deltaLength: delta.length,
            });
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
            this.debugLog("sendCurrentInput:onToolStart", {
              sendSeq,
              itemId: info.itemId,
              type: info.type,
              name: info.name,
            });
            const card = ensureToolCard(info.itemId, info);
            runningToolIds.add(info.itemId);
            activeToolItemId = info.itemId;
            card.complete("running");
            toolStartTimes.set(info.itemId, Date.now());
            toolMetadataById.set(info.itemId, {
              type: info.type,
              name: info.name,
              command: info.command,
              filePath: info.filePath,
            });
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
            this.debugLog("sendCurrentInput:onToolDelta", {
              sendSeq,
              deltaLength: delta.length,
            });
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
              const card = ensureToolCard(itemId, { type: "tool", name: t("toolOutput") });
              card.appendOutput(delta);
              const previous = toolOutputById.get(itemId) ?? "";
              toolOutputById.set(itemId, `${previous}${delta}`);
            }

            if (delta.trim().length > 0) {
              this.statusEl.setText(`${t("toolStatusPrefix")}: ${delta.trim().slice(0, 80)}`);
            }
          },
          onToolComplete: (info: ToolCompleteInfo) => {
            this.debugLog("sendCurrentInput:onToolComplete", {
              sendSeq,
              itemId: info.itemId,
              status: info.status,
            });
            const card = ensureToolCard(info.itemId, info);
            const startedAt = toolStartTimes.get(info.itemId);
            const durationMs = startedAt ? Date.now() - startedAt : undefined;
            card.complete(info.status, durationMs);
            this.statusPanel?.updateEntry(info.itemId, {
              status: this.resolveEntryStatus(info.status),
              duration: durationMs,
            });
            runningToolIds.delete(info.itemId);
            if (activeToolItemId === info.itemId) {
              const remaining = Array.from(runningToolIds);
              activeToolItemId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }

            const metadata = toolMetadataById.get(info.itemId);
            const diffEntry = this.inferDiffEntryFromTool(info, metadata);
            if (diffEntry) {
              turnDiffsByPath.set(diffEntry.filePath.toLowerCase(), diffEntry);
            }
            if (!detectedPlanFromTool) {
              detectedPlanFromTool = this.detectPlanFromToolOutput(
                info,
                toolOutputById.get(info.itemId) ?? "",
              );
            }
            tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
          },
          onSystem: (message) => {
            this.debugLog("sendCurrentInput:onSystem", {
              sendSeq,
              message,
            });
            this.appendSystemMessageToPanel(tab.panelEl, message);
          },
        },
        {
          model: this.modelSelect.value || undefined,
          effort: this.effortSelect.value || undefined,
          images: imageInputs.length > 0 ? imageInputs : undefined,
        },
      );
      if (imageInputs.length > 0) {
        try {
          this.imageContext?.clear();
        } catch (error) {
          this.debugError("sendCurrentInput:imageContext-clear-after-send", error);
        }
      }
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
      this.debugLog("sendCurrentInput:onComplete", {
        sendSeq,
        turnId: result.turnId,
        status: result.status,
        hasErrorMessage: Boolean(result.errorMessage),
      });
      this.currentTurnId = result.turnId;
      this.statusPanel?.setTurnStatus("streaming");
      const cancelledByUser = this.cancelledSendSequences.has(sendSeq);

      // Final render
      if (accumulated.trim().length === 0) {
        if (cancelledByUser || result.status === "cancelled") {
          accumulated = t("messageCancelledByUser");
        } else {
          accumulated = result.errorMessage || t("messageNoAssistantOutput");
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
        this.appendSystemMessageToPanel(tab.panelEl, tf("messageTurnFinishedStatus", {
          status: result.status,
          suffix,
        }));
      }

      if (result.status === "completed") {
        this.setReviewStateForTab(tab.state.tabId, Array.from(turnDiffsByPath.values()));
        const planCandidate = detectedPlanFromTool ?? this.detectPlanFromAssistantText(accumulated);
        if (planCandidate) {
          this.setPlanForTab(tab.state.tabId, planCandidate);
        }
      }
    } catch (error) {
      this.debugError("sendCurrentInput:onError", error, { sendSeq });
      const cancelledByUser = this.cancelledSendSequences.has(sendSeq);
      const message = error instanceof Error ? error.message : String(error);

      if (this.isThreadNotFoundMessage(message)) {
        this.debugLog("sendCurrentInput:thread-reset", {
          reason: message,
          tabId: tab.state.tabId,
        });
        cc.clearThreadId();
        this.plugin.client.setThreadId(null);
      }

      if (cancelledByUser) {
        const finalText = accumulated.trim().length > 0 ? accumulated : t("messageCancelledByUser");
        await this.messageRenderer.renderContent(assistantEl, finalText);
        cc.addMessage("assistant", finalText);
        finalizeThinking();
      } else {
        await this.messageRenderer.renderContent(assistantEl, t("messageNoAssistantOutput"));
        this.appendSystemMessageToPanel(tab.panelEl, tf("messageRequestFailed", { error: message }));
        if (imageInputs.length > 0 && this.isImageInputUnsupportedMessage(message)) {
          this.appendSystemMessageToPanel(tab.panelEl, t("messageImageUploadUnsupported"));
          new Notice(t("noticeImageUploadUnsupported"));
        }
        new Notice(tf("noticeCodexError", { error: message }));
        finalizeThinking();
      }
    } finally {
      this.debugLog("sendCurrentInput:finally", {
        sendSeq,
        running: this.running,
        queueLength: this.messageQueue.length,
      });
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
      } catch {
        // Keep message flow intact if context cleanup fails.
      }
      try {
        await this.processQueue();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(tf("noticeProcessQueueFailed", { error: message }));
      }
    }
  }

  private buildPromptWithTurnControls(prompt: string): string {
    const directives: string[] = [];
    const skill = this.plugin.settings.skillPreset.trim();
    if (skill && skill !== "none") {
      directives.push(`[Skill: ${skill}]`);
    }
    if (directives.length === 0) {
      return prompt;
    }
    return `${directives.join("\n")}\n\n${prompt}`;
  }

  private appendReviewCommentsToPrompt(prompt: string, comments: ReviewComment[]): string {
    if (comments.length === 0) {
      return prompt;
    }

    const lines = comments
      .map((comment) => {
        const scope = comment.scope.trim() || "general";
        const text = comment.text.trim();
        return text ? `- ${scope}: ${text}` : "";
      })
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return prompt;
    }

    return `${prompt}\n\n[${t("reviewPromptHeader")}]\n${lines.join("\n")}`;
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
        this.appendSystemMessageToPanel(tab.panelEl, tf("messageStartedNewThread", { threadId }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tab = this.tabManager.getActiveTab();
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, tf("messageFailedStartNewThread", { error: message }));
      new Notice(tf("noticeCodexError", { error: message }));
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
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, t("messageRestarted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tab = this.tabManager.getActiveTab();
      if (tab) this.appendSystemMessageToPanel(tab.panelEl, tf("messageRestartFailed", { error: message }));
      new Notice(tf("noticeCodexError", { error: message }));
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  private openSessionModal(): void {
    try {
      const modal = new SessionModal(this.app, {
        listConversations: async (filter) => await this.listConversations(filter),
        searchConversations: async (query, filter) => await this.searchConversations(query, filter),
        onOpen: async (meta) => await this.openConversation(meta.id),
        onFork: async (meta) => await this.forkConversation(meta.id),
        onTogglePin: async (meta, pinned) => {
          await this.updateConversationMeta(meta.id, { pinned });
        },
        onToggleArchive: async (meta, archived) => {
          await this.updateConversationMeta(meta.id, { archived });
        },
        onDelete: async (meta) => {
          await this.deleteConversation(meta.id);
        },
      });
      modal.open();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("sessionActionFailed", { error: message }));
    }
  }

  private getAnyConversationController(): ConversationController | null {
    const active = this.tabManager.getActiveConversationController();
    if (active) {
      return active;
    }
    for (const state of this.tabManager.getAllTabStates()) {
      const tab = this.tabManager.getTab(state.tabId);
      if (tab) {
        return tab.conversationController;
      }
    }
    return null;
  }

  private async listConversations(filter: ConversationListFilter): Promise<ConversationMeta[]> {
    const controller = this.getAnyConversationController();
    if (controller) {
      return await controller.listConversations(filter);
    }
    return await this.sessionStorage.listConversations(filter);
  }

  private async searchConversations(query: string, filter: ConversationListFilter): Promise<ConversationMeta[]> {
    const controller = this.getAnyConversationController();
    if (controller) {
      return await controller.searchConversations(query, filter);
    }
    return await this.sessionStorage.searchConversations(query, filter);
  }

  private async updateConversationMeta(
    id: string,
    partial: Partial<Pick<ConversationMeta, "archived" | "pinned" | "tags">>,
  ): Promise<ConversationMeta | null> {
    const controller = this.getAnyConversationController();
    if (controller) {
      return await controller.updateMeta(id, partial);
    }
    return await this.sessionStorage.updateMeta(id, partial);
  }

  private async openConversation(id: string): Promise<void> {
    const tab = await this.ensureActiveTabForInlineCard();
    if (!tab) return;

    const conv = await tab.conversationController.switchTo(id);
    if (!conv) {
      new Notice(t("noticeFailedLoadConversation"));
      return;
    }

    this.tabManager.setConversationId(tab.state.tabId, id);
    tab.panelEl.empty();
    this.setReviewStateForTab(tab.state.tabId, []);
    this.setPlanForTab(tab.state.tabId, null);

    await this.renderConversationMessages(tab.panelEl, conv.messages);

    this.plugin.client.setThreadId(conv.threadId ?? null);

    this.updateStatus();
    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;
  }

  private async deleteConversation(id: string): Promise<void> {
    const controller = this.getAnyConversationController();
    if (controller) {
      await controller.deleteConversation(id);
    } else {
      await this.sessionStorage.deleteConversation(id);
    }

    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;
    if (activeTab.state.conversationId !== id) return;

    activeTab.panelEl.empty();
    this.tabManager.setConversationId(activeTab.state.tabId, null);
    this.setReviewStateForTab(activeTab.state.tabId, []);
    this.setPlanForTab(activeTab.state.tabId, null);
    const ready = await this.ensureConversationReady(activeTab);
    if (ready) {
      this.appendSystemMessageToPanel(activeTab.panelEl, t("messageReadyHint"));
    }
  }

  private async forkConversation(id: string): Promise<void> {
    if (this.running) {
      new Notice(t("noticeCannotForkRunning"));
      return;
    }

    const currentTabCount = this.tabManager.getAllTabStates().length;
    if (currentTabCount >= this.plugin.settings.maxTabs) {
      new Notice(tf("noticeCannotForkMax", { max: this.plugin.settings.maxTabs }));
      return;
    }

    const sourceConversation = await this.sessionStorage.loadConversation(id);
    if (!sourceConversation) {
      new Notice(t("noticeFailedLoadConversation"));
      return;
    }

    const forkTab = this.tabManager.addTab();
    this.ensureReviewState(forkTab.state.tabId);
    this.ensurePlanState(forkTab.state.tabId);
    const forkTitle = `${t("sessionForkPrefix")} ${sourceConversation.title}`;
    const forkConv = await forkTab.conversationController.createNew(forkTitle);
    this.tabManager.setConversationId(forkTab.state.tabId, forkConv.id);
    forkTab.conversationController.setMessages(sourceConversation.messages);

    forkTab.panelEl.empty();
    await this.renderConversationMessages(forkTab.panelEl, sourceConversation.messages);

    try {
      const threadId = await this.plugin.client.newThread();
      forkTab.conversationController.setThreadId(threadId);
      this.appendSystemMessageToPanel(forkTab.panelEl, t("messageForkCreated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessageToPanel(forkTab.panelEl, tf("messageForkThreadFail", { error: message }));
    }

    this.tabManager.switchTo(forkTab.state.tabId);
    this.updateStatus();
  }

  private async renderConversationMessages(panelEl: HTMLElement, messages: ChatMessage[]): Promise<void> {
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const el = this.createMessageEl(panelEl, "assistant", msg.id);
        await this.messageRenderer.renderContent(el, msg.content);
      } else {
        this.appendMessageToPanel(
          panelEl,
          msg.role,
          msg.content,
          msg.id,
          msg.role === "user" ? msg.images : undefined,
        );
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

  private appendMessageToPanel(
    panelEl: HTMLElement,
    role: string,
    text: string,
    messageId?: string,
    images?: Array<{ name: string; dataUrl: string }>,
  ): HTMLElement {
    const el = this.createMessageEl(panelEl, role, messageId);
    el.setText(text);
    if (role === "user" && images && images.length > 0) {
      this.appendMessageImages(el, images);
    }
    panelEl.scrollTop = panelEl.scrollHeight;
    return el;
  }

  private appendMessageImages(
    messageEl: HTMLElement,
    images: Array<{ name: string; dataUrl: string }>,
  ): void {
    const validImages = images
      .map((image) => ({
        name: image.name,
        dataUrl: typeof image.dataUrl === "string" ? image.dataUrl.trim() : "",
      }))
      .filter((image) => image.dataUrl.length > 0);
    if (validImages.length === 0) {
      return;
    }

    const rowEl = messageEl.createDiv({ cls: "codexidian-msg-images" });
    for (const image of validImages) {
      const thumbEl = rowEl.createEl("img", { cls: "codexidian-msg-image-thumb" });
      thumbEl.src = image.dataUrl;
      thumbEl.alt = image.name;
      thumbEl.title = image.name;
      thumbEl.loading = "lazy";
    }
  }

  private attachUserMessageActions(wrapperEl: HTMLElement, messageId: string): void {
    const actionsEl = wrapperEl.createDiv({ cls: "codexidian-msg-actions" });

    const editBtn = actionsEl.createEl("button", {
      cls: "codexidian-msg-action-btn",
      text: "✏",
      title: t("editMessageTitle"),
    });
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.editMessage(messageId);
    });

    const rewindBtn = actionsEl.createEl("button", {
      cls: "codexidian-msg-action-btn",
      text: "↩",
      title: t("rewindTitle"),
    });
    rewindBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.rewindToMessage(messageId);
    });

    const forkBtn = actionsEl.createEl("button", {
      cls: "codexidian-msg-action-btn",
      text: "⑂",
      title: t("forkTitle"),
    });
    forkBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.forkFromMessage(messageId);
    });
  }

  private async editMessage(messageId: string): Promise<void> {
    if (this.running) {
      new Notice(t("noticeCannotEditRunning"));
      return;
    }

    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    const wrapperEl = this.getMessageWrapper(tab.panelEl, messageId);
    if (!wrapperEl || wrapperEl.dataset.msgRole !== "user") {
      new Notice(t("noticeCannotEditNotFound"));
      return;
    }
    if (wrapperEl.querySelector(".codexidian-msg-edit-area")) {
      return;
    }

    const messageEl = wrapperEl.querySelector<HTMLElement>(".codexidian-msg-user");
    if (!messageEl) return;

    const originalText = messageEl.textContent ?? "";
    const actionsEl = wrapperEl.querySelector<HTMLElement>(".codexidian-msg-actions");

    messageEl.style.display = "none";
    if (actionsEl) {
      actionsEl.style.display = "none";
    }

    const editWrapEl = wrapperEl.createDiv({ cls: "codexidian-msg-edit-wrap" });
    const editAreaEl = editWrapEl.createEl("textarea", { cls: "codexidian-msg-edit-area" });
    editAreaEl.value = originalText;

    const editActionsEl = editWrapEl.createDiv({ cls: "codexidian-msg-edit-actions" });
    const saveBtn = editActionsEl.createEl("button", {
      cls: "codexidian-msg-edit-save",
      text: t("saveAndResend"),
    });
    const cancelBtn = editActionsEl.createEl("button", {
      cls: "codexidian-msg-edit-cancel",
      text: t("cancel"),
    });

    const restore = () => {
      editWrapEl.remove();
      messageEl.style.display = "";
      if (actionsEl) {
        actionsEl.style.display = "";
      }
    };

    cancelBtn.addEventListener("click", () => {
      restore();
    });

    saveBtn.addEventListener("click", () => {
      void (async () => {
        const editedText = editAreaEl.value.trim();
        if (!editedText) {
          new Notice(t("noticeEditedMessageEmpty"));
          return;
        }

        const confirmed = window.confirm(t("confirmSaveEditResend"));
        if (!confirmed) {
          return;
        }

        saveBtn.disabled = true;
        cancelBtn.disabled = true;

        try {
          const target = await tab.conversationController.truncateAfter(messageId);
          if (!target || target.role !== "user") {
            new Notice(t("noticeEditMessageNotFound"));
            restore();
            return;
          }

          this.removePanelContentFromMessage(tab.panelEl, messageId);

          try {
            const threadId = await this.plugin.client.newThread();
            tab.conversationController.setThreadId(threadId);
            this.appendSystemMessageToPanel(tab.panelEl, t("messageEditedStartedFreshThread"));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.appendSystemMessageToPanel(
              tab.panelEl,
              tf("messageEditedSaveButThreadFail", { error: message }),
            );
          }

          this.setInputValue("");
          await this.sendCurrentInput(editedText);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(tf("noticeEditFailed", { error: message }));
          restore();
        }
      })();
    });

    editAreaEl.focus();
    editAreaEl.setSelectionRange(editAreaEl.value.length, editAreaEl.value.length);
  }

  private async applyCodeToNote(code: string, language: string, triggerEl?: HTMLElement): Promise<void> {
    const trimmedCode = code.trimEnd();
    if (!trimmedCode) {
      new Notice(t("noticeNoCodeToApply"));
      return;
    }

    const defaultPath = this.getCurrentMarkdownNotePath() ?? "";
    const targetInput = window.prompt(t("promptTargetNotePath"), defaultPath);
    if (targetInput === null) {
      return;
    }

    const targetPath = normalizePath((targetInput.trim() || defaultPath).trim());
    if (!targetPath) {
      new Notice(t("noticeTargetPathRequired"));
      return;
    }

    const pathValidation = this.getPathValidator().validate(targetPath, "write");
    if (!pathValidation.allowed) {
      new Notice(tf("securityBlocked", { reason: pathValidation.reason ?? t("securityBlockedReasonDefault") }));
      return;
    }

    const mode = await this.pickApplyMode(triggerEl);
    if (!mode) {
      return;
    }

    const modeLabel = mode === "replace-selection" ? t("replaceSelection") : t("appendToNote");
    if (this.plugin.settings.securityRequireApprovalForWrite) {
      const confirmed = window.confirm(tf("confirmApplyCode", { path: targetPath, mode: modeLabel }));
      if (!confirmed) {
        return;
      }
    }

    const maxBytes = this.getMaxNoteSizeBytes();
    try {
      if (mode === "replace-selection") {
        await this.applyCodeReplaceSelection(targetPath, trimmedCode, maxBytes);
      } else {
        await this.applyCodeAppendToNote(targetPath, trimmedCode, language, maxBytes);
      }
      new Notice(tf("noticeAppliedCode", { path: targetPath, mode: modeLabel }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeApplyCodeFailed", { error: message }));
    }
  }

  private async pickApplyMode(triggerEl?: HTMLElement): Promise<"replace-selection" | "append-to-note" | null> {
    const fallbackPick = (): "replace-selection" | "append-to-note" => {
      const replace = window.confirm(t("confirmApplyModeFallback"));
      return replace ? "replace-selection" : "append-to-note";
    };

    if (!triggerEl || !document.body) {
      return fallbackPick();
    }

    document.querySelectorAll(".codexidian-apply-mode-menu").forEach((el) => el.remove());

    return await new Promise<"replace-selection" | "append-to-note" | null>((resolve) => {
      const menuEl = document.createElement("div");
      menuEl.classList.add("codexidian-apply-mode-menu");

      const replaceBtn = document.createElement("button");
      replaceBtn.classList.add("codexidian-apply-mode-option");
      replaceBtn.textContent = t("replaceSelection");

      const appendBtn = document.createElement("button");
      appendBtn.classList.add("codexidian-apply-mode-option");
      appendBtn.textContent = t("appendToNote");

      const cancelBtn = document.createElement("button");
      cancelBtn.classList.add("codexidian-apply-mode-cancel");
      cancelBtn.textContent = t("applyModeCancel");

      menuEl.appendChild(replaceBtn);
      menuEl.appendChild(appendBtn);
      menuEl.appendChild(cancelBtn);
      document.body.appendChild(menuEl);

      const rect = triggerEl.getBoundingClientRect();
      const menuWidth = 210;
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
      const menuHeight = 132;
      const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6));
      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;

      let settled = false;
      const cleanup = (result: "replace-selection" | "append-to-note" | null) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("mousedown", onOutsideMouseDown, true);
        document.removeEventListener("keydown", onEscape, true);
        menuEl.remove();
        resolve(result);
      };

      const onOutsideMouseDown = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (menuEl.contains(target) || target === triggerEl) return;
        cleanup(null);
      };

      const onEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cleanup(null);
      };

      replaceBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup("replace-selection");
      });

      appendBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup("append-to-note");
      });

      cancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup(null);
      });

      window.setTimeout(() => {
        document.addEventListener("mousedown", onOutsideMouseDown, true);
        document.addEventListener("keydown", onEscape, true);
      }, 0);
    });
  }

  private async applyCodeReplaceSelection(targetPath: string, code: string, maxBytes: number): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      throw new Error(t("errorNoActiveEditor"));
    }

    const activePath = normalizePath(activeView.file.path);
    const normalizedTarget = normalizePath(targetPath);
    if (activePath !== normalizedTarget) {
      throw new Error(t("errorReplaceSelectionRequiresTarget"));
    }

    const selected = activeView.editor.getSelection();
    if (!selected) {
      throw new Error(t("errorNoSelectionToReplace"));
    }

    const currentText = activeView.editor.getValue();
    const projectedBytes = this.getByteLength(currentText) - this.getByteLength(selected) + this.getByteLength(code);
    if (projectedBytes > maxBytes) {
      throw new Error(tf("errorMaxSizeExceeded", { kb: this.plugin.settings.securityMaxNoteSize }));
    }

    activeView.editor.replaceSelection(code);
  }

  private async applyCodeAppendToNote(
    targetPath: string,
    code: string,
    language: string,
    maxBytes: number,
  ): Promise<void> {
    const normalizedTarget = normalizePath(targetPath);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalizedTarget);
    const fenced = this.formatFencedCode(code, language);

    if (abstractFile instanceof TFile) {
      const current = await this.app.vault.read(abstractFile);
      const separator = current.length === 0 ? "" : (current.endsWith("\n") ? "\n" : "\n\n");
      const nextContent = `${current}${separator}${fenced}\n`;
      if (this.getByteLength(nextContent) > maxBytes) {
        throw new Error(tf("errorMaxSizeExceeded", { kb: this.plugin.settings.securityMaxNoteSize }));
      }
      await this.app.vault.modify(abstractFile, nextContent);
      return;
    }

    if (abstractFile) {
      throw new Error(tf("errorTargetPathNotFile", { path: normalizedTarget }));
    }

    const initialContent = `${fenced}\n`;
    if (this.getByteLength(initialContent) > maxBytes) {
      throw new Error(tf("errorMaxSizeExceeded", { kb: this.plugin.settings.securityMaxNoteSize }));
    }

    await this.app.vault.create(normalizedTarget, initialContent);
  }

  private formatFencedCode(code: string, language: string): string {
    const lang = language.trim().toLowerCase();
    const label = lang && lang !== "text" ? lang : "";
    return `\`\`\`${label}\n${code}\n\`\`\``;
  }

  private getPathValidator(): PathValidator {
    return new PathValidator(this.plugin.settings.securityBlockedPaths);
  }

  private getMaxNoteSizeBytes(): number {
    const kb = Number.isFinite(this.plugin.settings.securityMaxNoteSize)
      ? Math.max(1, Math.round(this.plugin.settings.securityMaxNoteSize))
      : 500;
    return kb * 1024;
  }

  private getByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  private getMessageWrapper(panelEl: HTMLElement, messageId: string): HTMLElement | null {
    const children = Array.from(panelEl.children);
    for (const child of children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.msgId === messageId) {
        return child;
      }
    }
    return null;
  }

  private async rewindToMessage(messageId: string): Promise<void> {
    if (this.running) {
      new Notice(t("noticeCannotRewindRunning"));
      return;
    }

    const confirmed = window.confirm(t("confirmRewind"));
    if (!confirmed) {
      return;
    }

    const tab = this.tabManager.getActiveTab();
    if (!tab) return;

    try {
      const target = await tab.conversationController.truncateAfter(messageId);
      if (!target || target.role !== "user") {
        new Notice(t("noticeUnableRewind"));
        return;
      }

      this.removePanelContentFromMessage(tab.panelEl, messageId);
      this.setInputValue(target.content);
      this.inputEl.focus();

      try {
        const threadId = await this.plugin.client.newThread();
        tab.conversationController.setThreadId(threadId);
        this.appendSystemMessageToPanel(tab.panelEl, t("messageRewindComplete"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendSystemMessageToPanel(tab.panelEl, tf("messageRewindThreadFail", { error: message }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeRewindFailed", { error: message }));
    } finally {
      this.updateStatus();
    }
  }

  private async forkFromMessage(messageId: string): Promise<void> {
    if (this.running) {
      new Notice(t("noticeCannotForkRunning"));
      return;
    }

    const currentTabCount = this.tabManager.getAllTabStates().length;
    if (currentTabCount >= this.plugin.settings.maxTabs) {
      new Notice(tf("noticeCannotForkMax", { max: this.plugin.settings.maxTabs }));
      return;
    }

    const sourceTab = this.tabManager.getActiveTab();
    if (!sourceTab) return;

    try {
      const branchMessages = sourceTab.conversationController.getMessagesUpTo(messageId);
      if (branchMessages.length === 0) {
        new Notice(t("noticeUnableFork"));
        return;
      }

      const forkTab = this.tabManager.addTab();
      this.ensureReviewState(forkTab.state.tabId);
      this.ensurePlanState(forkTab.state.tabId);
      const forkConv = await forkTab.conversationController.createNew(`Fork ${new Date().toLocaleString()}`);
      this.tabManager.setConversationId(forkTab.state.tabId, forkConv.id);
      forkTab.conversationController.setMessages(branchMessages);

      forkTab.panelEl.empty();
      await this.renderConversationMessages(forkTab.panelEl, branchMessages);

      try {
        const threadId = await this.plugin.client.newThread();
        forkTab.conversationController.setThreadId(threadId);
        this.appendSystemMessageToPanel(forkTab.panelEl, t("messageForkCreated"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendSystemMessageToPanel(forkTab.panelEl, tf("messageForkThreadFail", { error: message }));
      }

      this.tabManager.switchTo(forkTab.state.tabId);
      this.updateStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(tf("noticeForkFailed", { error: message }));
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

  refreshLocale(): void {
    this.titleEl?.setText(t("appTitle"));
    this.updateHeaderButtons();
    this.inputEl.placeholder = t("askPlaceholder");
    this.modelLabelEl?.setText(t("model"));
    this.effortLabelEl?.setText(t("effort"));
    this.skillLabelEl?.setText(t("skill"));
    this.modeLabelEl?.setText(t("mode"));
    this.updateSkillButtonText();
    this.updateModeButtonText();
    if (this.attachBtn) {
      this.attachBtn.setAttr("aria-label", t("attachImage"));
      this.attachBtn.setAttr("title", t("attachImage"));
    }
    this.dropZoneTextEl?.setText(t("dropImagesHere"));
    this.updateSendButton();
    this.updateNoteContextToggle();
    this.registerBuiltinSlashCommands();
    this.statusPanel?.refreshLocale();
    this.reviewPane?.refreshLocale();
    for (const state of this.tabManager?.getAllTabStates() ?? []) {
      this.renderPlanCardForTab(state.tabId);
    }
    this.updateQueueIndicator();
    this.updateStatus();
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
        this.appendSystemMessageToPanel(panelEl, tf("messageContextFileNotFound", { path }));
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
        this.appendSystemMessageToPanel(panelEl, tf("messageContextFileReadFailed", { path, error: message }));
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
    this.noteContextToggleEl.setText(this.includeCurrentNoteContent ? t("noteToggleOn") : t("noteToggleOff"));
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
      bodyEl.createDiv({ cls: "codexidian-approval-meta", text: tf("approvalMetaFile", { path: request.filePath }) });
    }
    if (request.cwd) {
      bodyEl.createDiv({ cls: "codexidian-approval-meta", text: tf("approvalMetaCwd", { cwd: request.cwd }) });
    }
    if (!request.command && !request.filePath && request.params) {
      bodyEl.createEl("code", {
        text: JSON.stringify(request.params).slice(0, 800),
      });
    }

    const actionsEl = cardEl.createDiv({ cls: "codexidian-approval-actions" });
    const approveBtn = actionsEl.createEl("button", {
      cls: "codexidian-approval-btn approve",
      text: t("approve"),
    });
    const alwaysBtn = actionsEl.createEl("button", {
      cls: "codexidian-approval-btn codexidian-approval-always-btn",
      text: t("alwaysAllow"),
    });
    const denyBtn = actionsEl.createEl("button", {
      cls: "codexidian-approval-btn deny",
      text: t("deny"),
    });
    const statusEl = cardEl.createDiv({ cls: "codexidian-approval-status" });

    tab.panelEl.scrollTop = tab.panelEl.scrollHeight;

    return await new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        settle("decline", t("approvalTimedOut"));
      }, 60_000);

      const settle = (decision: ApprovalDecision, statusText: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);

        approveBtn.disabled = true;
        alwaysBtn.disabled = true;
        denyBtn.disabled = true;
        cardEl.addClass("codexidian-approval-card-readonly");
        cardEl.addClass(decision === "accept" ? "codexidian-approval-accepted" : "codexidian-approval-denied");
        statusEl.setText(tf("approvalDecisionPrefix", { status: statusText }));
        this.statusPanel?.updateEntry(statusEntryId, {
          status: decision === "accept" ? "completed" : "failed",
        });
        this.restoreStatusAfterInteractiveCard();
        resolve(decision);
      };

      approveBtn.addEventListener("click", () => settle("accept", t("approvalApproved")));
      alwaysBtn.addEventListener("click", () => {
        void (async () => {
          try {
            const result = await this.plugin.addAllowRuleFromApprovalRequest(request);
            const typeLabel = this.getAllowRuleTypeLabel(result.ruleType);
            if (result.status === "added") {
              new Notice(tf("noticeAllowRuleAdded", { type: typeLabel, pattern: result.pattern }));
            } else if (result.status === "exists") {
              new Notice(tf("noticeAllowRuleExists", { type: typeLabel, pattern: result.pattern }));
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(tf("noticeAllowRuleAddFailed", { error: message }));
          } finally {
            settle("accept", t("approvalAlwaysAllowed"));
          }
        })();
      });
      denyBtn.addEventListener("click", () => settle("decline", t("approvalDenied")));
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
      label: t("statusUserInputRequest"),
      detail: this.truncateStatusDetail(request.questions.map((question) => question.id).join(", ")),
      status: "running",
    });

    const cardEl = tab.panelEl.createDiv({ cls: "codexidian-user-input-card" });
    const headerEl = cardEl.createDiv({ cls: "codexidian-user-input-header" });
    headerEl.createSpan({ text: t("userInputRequest") });

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
        placeholder: t("userInputPlaceholder"),
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
      text: t("submit"),
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
        settle(resolveResponse(true), t("userInputTimedOutDefault"), true);
      }, 60_000);

      const settle = (response: UserInputResponse, statusText: string, failed = false) => {
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
          status: failed ? "failed" : "completed",
        });
        this.restoreStatusAfterInteractiveCard();
        resolve(response);
      };

      submitBtn.addEventListener("click", () => {
        settle(resolveResponse(false), t("userInputSubmitted"), false);
      });
    });
  }

  updateStatus(): void {
    const settings = this.plugin.settings;
    const threadId = this.plugin.client.getThreadId();
    const connected = this.plugin.client.isRunning();
    const engineText = connected ? t("connected") : t("disconnected");
    const runningText = this.running ? t("running") : t("idle");
    const threadText = threadId ? `${t("thread")} ${threadId.slice(0, 8)}...` : t("noThread");
    this.statusEl.setText(
      `${engineText} | ${runningText} | ${threadText} | ${settings.model || t("defaultModel")} | ${settings.thinkingEffort} | ${settings.approvalPolicy}`,
    );
    this.updateHeaderButtons();
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;
    this.newThreadBtn.disabled = this.running;
    this.restartBtn.disabled = this.running;
    this.updateQueueIndicator();
  }

  private updateHeaderButtons(): void {
    this.setHeaderIconButton(this.historyBtn, "clock", t("history"));
    this.setHeaderIconButton(this.newThreadBtn, "file-plus", t("newThread"));
    const restartTitle = this.plugin.client?.isRunning() ? t("restart") : t("reconnect");
    this.setHeaderIconButton(this.restartBtn, "refresh-cw", restartTitle);
  }

  private setHeaderIconButton(
    button: HTMLButtonElement | null | undefined,
    icon: string,
    tooltip: string,
  ): void {
    if (!button) return;
    setIcon(button, icon);
    button.setAttribute("aria-label", tooltip);
  }

  private updateSendButton(): void {
    if (!this.sendBtn) return;
    setIcon(this.sendBtn, "arrow-up");
    this.sendBtn.setAttribute("aria-label", t("send"));
  }

  private autoResizeInput(): void {
    if (!this.inputEl) return;
    this.inputEl.style.height = "auto";
    const newHeight = Math.min(Math.max(this.inputEl.scrollHeight, 80), 300);
    this.inputEl.style.height = `${newHeight}px`;
  }

  private setInputValue(value: string): void {
    this.inputEl.value = value;
    this.autoResizeInput();
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
        new Notice(tf("noticeRestoreTabsFailed", { error: message }));
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
      return t("approvalTitleCommand");
    }
    if (type === "fileChange" || type === "applyPatch") {
      return t("approvalTitleFile");
    }
    return t("approvalTitleGeneric");
  }

  private detectPlanFromToolOutput(info: ToolCompleteInfo, output: string): PlanUpdate | null {
    const signature = `${info.type || ""} ${info.name || ""}`.toLowerCase();
    const likelyPlanTool = signature.includes("plan");
    if (!likelyPlanTool && !output.trim()) {
      return null;
    }

    const parsed = this.parseStructuredPlan(output);
    if (parsed) {
      return parsed;
    }
    if (!likelyPlanTool) {
      return null;
    }
    return this.detectPlanFromAssistantText(output);
  }

  private detectPlanFromAssistantText(content: string): PlanUpdate | null {
    const markdownPlan = this.parseMarkdownPlan(content);
    if (markdownPlan) {
      return markdownPlan;
    }
    return this.parseStructuredPlan(content);
  }

  private parseStructuredPlan(raw: unknown): PlanUpdate | null {
    const parsedValue = this.parseUnknownJson(raw);
    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    const record = parsedValue as Record<string, unknown>;
    const candidate = (record.plan && typeof record.plan === "object") ? record.plan as Record<string, unknown> : record;
    const rawSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
    if (rawSteps.length === 0) {
      return null;
    }

    const steps: PlanStep[] = [];
    for (let index = 0; index < rawSteps.length; index++) {
      const rawStep = rawSteps[index];
      if (typeof rawStep === "string") {
        const text = rawStep.trim();
        if (!text) continue;
        steps.push({
          id: `plan-step-${index + 1}`,
          index: index + 1,
          description: text,
          status: "pending",
        });
        continue;
      }

      if (!rawStep || typeof rawStep !== "object") continue;
      const stepObj = rawStep as Record<string, unknown>;
      const descriptionCandidate = (
        stepObj.description
        ?? stepObj.text
        ?? stepObj.title
      );
      const description = typeof descriptionCandidate === "string" ? descriptionCandidate.trim() : "";
      if (!description) continue;
      const rawStatus = typeof stepObj.status === "string" ? stepObj.status : "pending";
      const rawId = typeof stepObj.id === "string" ? stepObj.id.trim() : "";
      steps.push({
        id: rawId || `plan-step-${index + 1}`,
        index: index + 1,
        description,
        status: this.normalizePlanStepStatus(rawStatus),
      });
    }

    if (steps.length === 0) {
      return null;
    }

    const rawTitle = (
      candidate.title
      ?? candidate.name
      ?? candidate.summary
    );
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : t("planTitle");
    const rawStatus = typeof candidate.status === "string" ? candidate.status : "proposed";
    const rawPlanId = typeof candidate.planId === "string" ? candidate.planId : (
      typeof candidate.id === "string" ? candidate.id : ""
    );

    return {
      planId: rawPlanId.trim() || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      steps,
      status: this.normalizePlanStatus(rawStatus),
    };
  }

  private parseMarkdownPlan(content: string): PlanUpdate | null {
    if (!content || !content.trim()) return null;

    const hasPlanHeading = /(^|\n)\s*#{2,4}\s*(plan|steps?)\b/i.test(content);
    const lines = content.split(/\r?\n/);
    const steps: PlanStep[] = [];

    for (const line of lines) {
      const numbered = line.match(/^\s*(\d+)[\.\)]\s+(.+)$/);
      if (numbered) {
        const description = numbered[2].trim();
        if (description) {
          steps.push({
            id: `plan-step-${steps.length + 1}`,
            index: steps.length + 1,
            description,
            status: "pending",
          });
        }
        continue;
      }

      if (hasPlanHeading) {
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) {
          const description = bullet[1].trim();
          if (description) {
            steps.push({
              id: `plan-step-${steps.length + 1}`,
              index: steps.length + 1,
              description,
              status: "pending",
            });
          }
        }
      }
    }

    const isValidPlan = hasPlanHeading ? steps.length >= 2 : steps.length >= 3;
    if (!isValidPlan) {
      return null;
    }

    return {
      planId: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: t("planTitle"),
      steps,
      status: "proposed",
    };
  }

  private parseUnknownJson(raw: unknown): unknown {
    if (raw && typeof raw === "object") {
      return raw;
    }
    if (typeof raw !== "string") {
      return null;
    }

    const trimmed = raw.trim();
    if (!trimmed) return null;

    const candidates = [trimmed];
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      candidates.unshift(fencedMatch[1].trim());
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // Try next candidate.
      }
    }

    return null;
  }

  private normalizePlanStatus(status: string): PlanUpdate["status"] {
    const normalized = status.trim().toLowerCase();
    if (normalized === "approved") return "approved";
    if (normalized === "in_progress" || normalized === "inprogress" || normalized === "executing") return "in_progress";
    if (normalized === "completed" || normalized === "done") return "completed";
    return "proposed";
  }

  private normalizePlanStepStatus(status: string): PlanStep["status"] {
    const normalized = status.trim().toLowerCase();
    if (normalized === "approved") return "approved";
    if (normalized === "executing" || normalized === "in_progress" || normalized === "inprogress") return "executing";
    if (normalized === "completed" || normalized === "done") return "completed";
    if (normalized === "failed" || normalized === "error") return "failed";
    if (normalized === "skipped") return "skipped";
    return "pending";
  }

  private inferDiffEntryFromTool(
    completeInfo: ToolCompleteInfo,
    startInfo?: Partial<ToolStartInfo>,
  ): DiffEntry | null {
    if (this.resolveEntryStatus(completeInfo.status) !== "completed") {
      return null;
    }

    const type = (completeInfo.type || startInfo?.type || "").trim().toLowerCase();
    const name = (completeInfo.name || startInfo?.name || "").trim();
    const command = (completeInfo.command || startInfo?.command || "").trim();
    const filePath = (
      completeInfo.filePath
      || startInfo?.filePath
      || this.extractFilePathFromCommand(command)
    )?.trim();

    if (!filePath) {
      return null;
    }

    const status = this.inferDiffStatusFromTool(type, name, command);
    const summarySource = command || name || completeInfo.type;
    return {
      filePath,
      status,
      summary: this.truncateStatusDetail(summarySource),
    };
  }

  private inferDiffStatusFromTool(
    type: string,
    name: string,
    command: string,
  ): DiffEntry["status"] {
    const signature = `${type} ${name} ${command}`.toLowerCase();

    if (
      signature.includes("delete")
      || signature.includes("remove")
      || signature.includes("unlink")
      || signature.includes(" rm ")
    ) {
      return "deleted";
    }

    if (
      signature.includes("create")
      || signature.includes("new_file")
      || signature.includes("add_file")
      || signature.includes("mkdir")
      || signature.includes("touch ")
    ) {
      return "added";
    }

    return "modified";
  }

  private extractFilePathFromCommand(command: string): string | null {
    if (!command) return null;

    const quoted = command.match(/["']([^"']+\.[\w-]+)["']/);
    if (quoted && quoted[1]) {
      return normalizePath(quoted[1]);
    }

    const parts = command.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index];
      if (!part) continue;
      if (part.startsWith("-")) continue;
      if (part.includes("/") || part.includes("\\")) {
        return normalizePath(part.replace(/^['"]|['"]$/g, ""));
      }
      if (/\.[a-zA-Z0-9]{1,8}$/.test(part)) {
        return normalizePath(part.replace(/^['"]|['"]$/g, ""));
      }
    }

    return null;
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

  private getAllowRuleTypeLabel(type: "command" | "file_write" | "tool"): string {
    if (type === "command") return t("allowRuleTypeCommand");
    if (type === "file_write") return t("allowRuleTypeFileWrite");
    return t("allowRuleTypeTool");
  }

  private isThreadNotFoundMessage(message: string): boolean {
    return message.toLowerCase().includes("thread not found");
  }

  private isImageInputUnsupportedMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    if (!normalized.includes("image")) {
      return false;
    }
    return (
      normalized.includes("unknown variant")
      || normalized.includes("invalid")
      || normalized.includes("failed to parse")
      || normalized.includes("deserialize")
      || normalized.includes("not supported")
      || normalized.includes("unsupported")
    );
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

  private debugLog(event: string, payload?: unknown): void {
    if (payload === undefined) {
      console.log(`[CODEXIDIAN DEBUG] ${event}`);
      return;
    }
    console.log(`[CODEXIDIAN DEBUG] ${event} ${this.stringifyDebug(payload)}`);
  }

  private debugError(event: string, error: unknown, extra?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    const payload = {
      ...(extra ?? {}),
      message,
      stack,
    };
    console.error(`[CODEXIDIAN DEBUG] ${event} ${this.stringifyDebug(payload)}`);
  }

  private stringifyDebug(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
