import {
  App,
  FileSystemAdapter,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";

import { CodexAppServerClient } from "./CodexAppServerClient";
import { CodexCliConfigService } from "./config/CodexCliConfigService";
import { CodexidianView, VIEW_TYPE_CODEXIDIAN } from "./CodexidianView";
import { isLocale, setLocale, t, tf } from "./i18n";
import { VaultMcpService, type VaultMcpWriteApprovalRequest } from "./mcp/VaultMcpService";
import {
  APPROVAL_MODES,
  type AllowRule,
  type AllowRuleType,
  DEFAULT_SETTINGS,
  type ApprovalDecision,
  type ApprovalRequest,
  type CodexidianSettings,
  EFFORT_OPTIONS,
  formatExactTokenCount,
  formatTokenWindow,
  isApprovalMode,
  migrateLegacyContextWindowSize,
  type McpToolCallRequest,
  type McpToolCallResult,
  normalizeContextWindowOverride,
  normalizeModelOverride,
  type ResolvedCodexCliConfig,
  type UserInputRequest,
  type UserInputResponse,
} from "./types";

export default class CodexidianPlugin extends Plugin {
  settings: CodexidianSettings = { ...DEFAULT_SETTINGS };
  client!: CodexAppServerClient;
  private mcpService!: VaultMcpService;
  private cliConfigService!: CodexCliConfigService;
  private resolvedCliConfig: ResolvedCodexCliConfig | null = null;
  private pendingRuntimeRefresh = false;
  private pendingRuntimeRestart = false;
  private lastCliConfigWarning: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    setLocale(this.settings.locale);
    this.cliConfigService = new CodexCliConfigService();
    this.mcpService = new VaultMcpService(
      this.app,
      () => ({
        blockedPatterns: this.settings.securityBlockedPaths,
        requireApprovalForWrite: this.settings.securityRequireApprovalForWrite,
        maxNoteSizeKb: this.settings.securityMaxNoteSize,
      }),
      async (request) => await this.requestMcpWriteApproval(request),
    );

    this.client = new CodexAppServerClient(
      () => this.settings,
      () => this.resolvedCliConfig,
      () => this.getVaultBasePath(),
      (threadId) => {
        if (!this.settings.persistThread) {
          return;
        }
        this.settings.lastThreadId = threadId;
        void this.saveSettings();
      },
      (message) => {
        const view = this.getOpenView();
        if (view) {
          view.appendSystemMessage(message);
          view.updateStatus();
        }
      },
      async (request) => await this.handleApprovalRequest(request),
      async (request) => await this.handleUserInputRequest(request),
      async (request) => await this.handleMcpToolCall(request),
    );

    await this.refreshResolvedCliConfig({ queueRuntimeReset: false, restartClient: false });
    this.cliConfigService.watchConfigFile(() => {
      void this.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true, fromWatcher: true });
    });

    this.registerView(
      VIEW_TYPE_CODEXIDIAN,
      (leaf: WorkspaceLeaf) => new CodexidianView(leaf, this),
    );

    this.addRibbonIcon("bot", t("openCodexidianCommand"), () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-codexidian",
      name: t("openCodexidianCommand"),
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "codexidian-new-thread",
      name: t("startNewThreadCommand"),
      callback: async () => {
        try {
          const threadId = await this.client.newThread();
          new Notice(tf("noticeNewThreadCreated", { threadId: threadId.slice(0, 8) }));
          this.refreshStatus();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(tf("noticeCodexError", { error: message }));
        }
      },
    });

    this.addSettingTab(new CodexidianSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.cliConfigService?.dispose();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEXIDIAN);
    if (this.client) {
      await this.client.dispose();
    }
  }

  getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return process.cwd();
  }

  getOpenView(): CodexidianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEXIDIAN);
    if (leaves.length === 0) {
      return null;
    }

    const view = leaves[0].view;
    if (view instanceof CodexidianView) {
      return view;
    }
    return null;
  }

  getResolvedCliConfig(): ResolvedCodexCliConfig | null {
    return this.resolvedCliConfig;
  }

  getCliBaselineResolvedConfig(): ResolvedCodexCliConfig | null {
    if (!this.cliConfigService) {
      return null;
    }

    return this.cliConfigService.resolveEffectiveConfig({
      codexCommand: this.settings.codexCommand,
      modelOverride: "",
      contextWindowOverrideTokens: null,
    });
  }

  getEffectiveModel(): string {
    return normalizeModelOverride(this.resolvedCliConfig?.model);
  }

  getEffectiveContextWindowTokens(): number {
    return normalizeContextWindowOverride(this.resolvedCliConfig?.contextWindowTokens) ?? 128_000;
  }

  getEffectiveModelDisplay(): string {
    return this.getEffectiveModel() || t("defaultModel");
  }

  getEffectiveContextWindowDisplay(): string {
    return formatTokenWindow(this.getEffectiveContextWindowTokens());
  }

  getEffectiveContextWindowExactDisplay(): string {
    return formatExactTokenCount(this.getEffectiveContextWindowTokens());
  }

  getModelSourceSummary(): string {
    if (!this.resolvedCliConfig) {
      return t("settingResolvedSourceUnknown");
    }
    return this.describeResolvedSource(this.resolvedCliConfig.modelSource, this.resolvedCliConfig.profile);
  }

  getContextWindowSourceSummary(): string {
    if (!this.resolvedCliConfig) {
      return t("settingResolvedSourceUnknown");
    }
    return this.describeResolvedSource(this.resolvedCliConfig.contextWindowSource, this.resolvedCliConfig.profile);
  }

  getRuntimeStatusLines(): string[] {
    const status = this.resolvedCliConfig?.runtimeStatus;
    const unknown = t("runtimeStatusUnknown");
    if (!status) {
      return [
        tf("runtimeStatusConfigLine", { path: unknown }),
        t("runtimeStatusRestartLine"),
      ];
    }

    const providerParts = [status.modelProvider ?? unknown];
    if (status.providerName) {
      providerParts.push(status.providerName);
    }
    if (status.wireApi) {
      providerParts.push(`wire_api=${status.wireApi}`);
    }

    const routing = status.usesLocalRouting
      ? t("runtimeStatusLocalRouting")
      : status.baseUrl
        ? t("runtimeStatusDirectEndpoint")
        : unknown;

    return [
      tf("runtimeStatusConfigLine", { path: status.configPath }),
      tf("runtimeStatusProviderLine", { provider: providerParts.join(" / ") }),
      tf("runtimeStatusModelLine", { model: this.getEffectiveModelDisplay() }),
      tf("runtimeStatusEndpointLine", { endpoint: status.baseUrl ?? unknown }),
      tf("runtimeStatusRoutingLine", { routing }),
      tf("runtimeStatusCcSwitchLine", {
        status: status.looksLikeCcSwitchCustomProvider
          ? t("runtimeStatusCcSwitchDetected")
          : t("runtimeStatusCcSwitchNotDetected"),
      }),
      tf("runtimeStatusTokenLine", {
        token: status.hasProviderScopedToken
          ? t("runtimeStatusTokenPresent")
          : t("runtimeStatusTokenMissing"),
      }),
      t("runtimeStatusRestartLine"),
    ];
  }

  private describeResolvedSource(source: ResolvedCodexCliConfig["modelSource"], profile: string | null): string {
    if (source === "override") {
      return t("sourceOverrideShort");
    }
    if (source === "profile" && profile) {
      return `CLI profile:${profile}`;
    }
    if (source === "command") {
      return "CLI command";
    }
    if (source === "config") {
      return "CLI config";
    }
    return t("sourceCliShort");
  }

  hasPendingRuntimeRefresh(): boolean {
    return this.pendingRuntimeRefresh;
  }

  async refreshResolvedCliConfig(options: {
    queueRuntimeReset?: boolean;
    restartClient?: boolean;
    fromWatcher?: boolean;
  } = {}): Promise<ResolvedCodexCliConfig> {
    const nextResolved = this.cliConfigService.resolveEffectiveConfig({
      codexCommand: this.settings.codexCommand,
      modelOverride: this.settings.modelOverride,
      contextWindowOverrideTokens: this.settings.contextWindowOverrideTokens,
    });
    const previousResolved = this.resolvedCliConfig;
    this.resolvedCliConfig = nextResolved;

    if (nextResolved.warningMessage && nextResolved.warningMessage !== this.lastCliConfigWarning) {
      this.lastCliConfigWarning = nextResolved.warningMessage;
      const view = this.getOpenView();
      view?.appendSystemMessage(tf("messageCliConfigWarning", { error: nextResolved.warningMessage }));
      if (!options.fromWatcher) {
        new Notice(tf("noticeCliConfigWarning", { error: nextResolved.warningMessage }));
      }
    } else if (!nextResolved.warningMessage) {
      this.lastCliConfigWarning = null;
    }

    const resolvedChanged = !previousResolved
      || previousResolved.model !== nextResolved.model
      || previousResolved.contextWindowTokens !== nextResolved.contextWindowTokens
      || previousResolved.profile !== nextResolved.profile
      || previousResolved.modelSource !== nextResolved.modelSource
      || previousResolved.contextWindowSource !== nextResolved.contextWindowSource
      || JSON.stringify(previousResolved.runtimeStatus) !== JSON.stringify(nextResolved.runtimeStatus);

    const view = this.getOpenView();
    view?.refreshRuntimeConfigUi();
    this.refreshStatus();

    if (resolvedChanged && options.queueRuntimeReset) {
      await this.applyRuntimeSettingsChange({ restartClient: options.restartClient, message: t("messageRuntimeResetPending") });
    }

    return nextResolved;
  }

  async applyRuntimeSettingsChange(options: { restartClient?: boolean; message?: string } = {}): Promise<void> {
    const view = this.getOpenView();
    const isRunning = view?.isTurnRunning() ?? false;
    const notifyPending = isRunning && !this.pendingRuntimeRefresh;

    this.pendingRuntimeRefresh = true;
    this.pendingRuntimeRestart = this.pendingRuntimeRestart || Boolean(options.restartClient);
    await this.saveSettings();

    if (notifyPending) {
      view?.appendSystemMessage(options.message ?? t("messageRuntimeResetPending"));
      view?.updateStatus();
    }

    if (!isRunning) {
      await this.applyPendingRuntimeConfigChange();
    }
  }

  async applyPendingRuntimeConfigChange(): Promise<void> {
    if (!this.pendingRuntimeRefresh) {
      return;
    }

    this.settings.lastThreadId = "";
    this.client.setThreadId(null);

    const shouldRestartClient = this.pendingRuntimeRestart && this.client.isRunning();
    const view = this.getOpenView();
    view?.clearActiveConversationThread(t("messageRuntimeReset"));
    view?.refreshRuntimeConfigUi();

    this.pendingRuntimeRefresh = false;
    this.pendingRuntimeRestart = false;
    await this.saveSettings();

    if (shouldRestartClient) {
      await this.client.restart();
    }

    this.refreshStatus();
  }

  async prepareForSend(): Promise<void> {
    await this.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true });
    await this.applyPendingRuntimeConfigChange();
  }

  async updateModelOverride(value: string): Promise<string> {
    const normalized = normalizeModelOverride(value);
    this.settings.modelOverride = normalized;
    await this.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true });
    return normalized;
  }

  async updateContextWindowOverride(value: number | null): Promise<number | null> {
    const normalized = normalizeContextWindowOverride(value);
    this.settings.contextWindowOverrideTokens = normalized;
    await this.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true });
    return normalized;
  }

  private async handleApprovalRequest(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.settings.approvalMode === "safe") {
      return "decline";
    }
    if (this.settings.approvalMode === "yolo") {
      return "accept";
    }

    const matchedRule = this.findMatchingAllowRule(request);
    if (matchedRule) {
      const view = this.getOpenView();
      if (view) {
        view.appendSystemMessage(tf("messageAutoApprovedByRule", {
          summary: this.buildApprovalSummary(request),
          pattern: matchedRule.pattern,
        }));
        view.updateStatus();
      }
      return "accept";
    }

    let view = this.getOpenView();
    if (!view) {
      await this.activateView();
      view = this.getOpenView();
    }
    if (!view) {
      throw new Error("Codexidian view is not available for approval.");
    }
    return await view.showApprovalCard(request);
  }

  async addAllowRuleFromApprovalRequest(
    request: ApprovalRequest,
  ): Promise<{ status: "added" | "exists"; ruleType: AllowRuleType; pattern: string }> {
    const candidate = this.extractAllowRuleCandidate(request);
    if (!candidate) {
      throw new Error("Unable to extract allow rule from approval request.");
    }

    const existing = this.settings.allowRules.find((rule) => (
      rule.type === candidate.type && rule.pattern === candidate.pattern
    ));
    if (existing) {
      return {
        status: "exists",
        ruleType: existing.type,
        pattern: existing.pattern,
      };
    }

    const rule: AllowRule = {
      id: `allow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: candidate.type,
      pattern: candidate.pattern,
      createdAt: Date.now(),
    };
    this.settings.allowRules.push(rule);
    await this.saveSettings();
    return {
      status: "added",
      ruleType: rule.type,
      pattern: rule.pattern,
    };
  }

  private async handleUserInputRequest(request: UserInputRequest): Promise<UserInputResponse> {
    let view = this.getOpenView();
    if (!view) {
      await this.activateView();
      view = this.getOpenView();
    }
    if (!view) {
      throw new Error("Codexidian view is not available for user input.");
    }
    return await view.showUserInputCard(request);
  }

  private async handleMcpToolCall(request: McpToolCallRequest): Promise<McpToolCallResult> {
    if (!this.settings.enableMcp) {
      return {
        success: false,
        isError: true,
        contentItems: [{ type: "inputText", text: t("mcpDisabledMessage") }],
      };
    }

    try {
      return await this.mcpService.handleToolCall(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        isError: true,
        contentItems: [{ type: "inputText", text: tf("mcpToolExecutionFailed", { error: message }) }],
      };
    }
  }

  private async requestMcpWriteApproval(request: VaultMcpWriteApprovalRequest): Promise<boolean> {
    if (!this.settings.securityRequireApprovalForWrite) {
      return true;
    }

    try {
      const decision = await this.handleApprovalRequest({
        requestId: `mcp-write-${Date.now()}`,
        type: "fileChange",
        filePath: request.path,
        params: {
          source: "mcp/write_note",
          mode: request.mode,
          sizeBytes: request.contentBytes,
          preview: request.content.slice(0, 300),
        },
      });
      return decision === "accept";
    } catch {
      return false;
    }
  }

  async collectMcpContextForPrompt(
    prompt: string,
    currentNotePath: string | null,
    existingPaths: Set<string> = new Set<string>(),
  ): Promise<Array<{ path: string; content: string }>> {
    if (!this.settings.enableMcp) {
      return [];
    }

    const limit = this.settings.mcpContextNoteLimit;
    if (limit <= 0) {
      return [];
    }

    try {
      return await this.mcpService.collectRelatedNotes(prompt, currentNotePath, {
        limit,
        maxCharsPerNote: 8_000,
        excludePaths: existingPaths,
      });
    } catch {
      return [];
    }
  }

  refreshStatus(): void {
    const view = this.getOpenView();
    view?.updateStatus();
  }

  async activateView(): Promise<void> {
    const workspace = this.app.workspace;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CODEXIDIAN)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_CODEXIDIAN, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as (Partial<CodexidianSettings> & {
      model?: string;
      contextWindowSize?: number;
    }) | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    let needsSave = false;

    if (!isLocale(this.settings.locale)) {
      this.settings.locale = DEFAULT_SETTINGS.locale;
      needsSave = true;
    }
    setLocale(this.settings.locale);

    if (!this.settings.workingDirectory.trim()) {
      this.settings.workingDirectory = this.getVaultBasePath();
      needsSave = true;
    }

    const loadedModelOverride = normalizeModelOverride(
      this.settings.modelOverride || loaded?.model,
    );
    if (loadedModelOverride !== this.settings.modelOverride) {
      this.settings.modelOverride = loadedModelOverride;
      needsSave = true;
    }

    const migratedContextWindowOverride = migrateLegacyContextWindowSize(
      this.settings.contextWindowOverrideTokens ?? loaded?.contextWindowSize,
    );
    if (migratedContextWindowOverride !== this.settings.contextWindowOverrideTokens) {
      this.settings.contextWindowOverrideTokens = migratedContextWindowOverride;
      needsSave = true;
    }

    if (!isApprovalMode(this.settings.approvalMode)) {
      const legacyModeRaw = String((loaded as any)?.collaborationMode ?? "").trim().toLowerCase();
      this.settings.approvalMode = (
        legacyModeRaw === "autonomous"
        || legacyModeRaw === "interactive"
        || legacyModeRaw === "plan-first"
      )
        ? DEFAULT_SETTINGS.approvalMode
        : DEFAULT_SETTINGS.approvalMode;
      needsSave = true;
    }

    if (!Array.isArray(this.settings.securityBlockedPaths)) {
      this.settings.securityBlockedPaths = [...DEFAULT_SETTINGS.securityBlockedPaths];
      needsSave = true;
    } else {
      const normalizedBlockedPaths = this.settings.securityBlockedPaths
        .map((pattern) => String(pattern).trim())
        .filter((pattern) => pattern.length > 0);
      if (normalizedBlockedPaths.length !== this.settings.securityBlockedPaths.length) {
        needsSave = true;
      }
      this.settings.securityBlockedPaths = normalizedBlockedPaths;
    }

    if (typeof this.settings.enableReviewPane !== "boolean") {
      this.settings.enableReviewPane = DEFAULT_SETTINGS.enableReviewPane;
      needsSave = true;
    }

    const normalizedAllowRules = this.normalizeAllowRules(this.settings.allowRules);
    if (normalizedAllowRules.length !== this.settings.allowRules.length) {
      needsSave = true;
    }
    this.settings.allowRules = normalizedAllowRules;

    if (!Number.isFinite(this.settings.securityMaxNoteSize) || this.settings.securityMaxNoteSize <= 0) {
      this.settings.securityMaxNoteSize = DEFAULT_SETTINGS.securityMaxNoteSize;
      needsSave = true;
    }

    if (!Number.isFinite(this.settings.mcpContextNoteLimit) || this.settings.mcpContextNoteLimit < 0) {
      this.settings.mcpContextNoteLimit = DEFAULT_SETTINGS.mcpContextNoteLimit;
      needsSave = true;
    }

    if (typeof this.settings.modelOverride !== "string") {
      this.settings.modelOverride = DEFAULT_SETTINGS.modelOverride;
      needsSave = true;
    }

    if (
      this.settings.contextWindowOverrideTokens !== null
      && !Number.isFinite(this.settings.contextWindowOverrideTokens)
    ) {
      this.settings.contextWindowOverrideTokens = DEFAULT_SETTINGS.contextWindowOverrideTokens;
      needsSave = true;
    }

    if (needsSave) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private normalizeAllowRules(input: unknown): AllowRule[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const normalized: AllowRule[] = [];
    for (const entry of input) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const typeValue = String((entry as Partial<AllowRule>).type ?? "").trim();
      if (!this.isAllowRuleType(typeValue)) {
        continue;
      }
      const pattern = String((entry as Partial<AllowRule>).pattern ?? "").trim();
      if (!pattern) {
        continue;
      }
      const createdAtRaw = Number((entry as Partial<AllowRule>).createdAt);
      const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : Date.now();
      const idRaw = String((entry as Partial<AllowRule>).id ?? "").trim();
      const id = idRaw || `allow-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
      normalized.push({
        id,
        type: typeValue,
        pattern,
        createdAt,
      });
    }
    return normalized;
  }

  private isAllowRuleType(value: string): value is AllowRuleType {
    return value === "command" || value === "file_write" || value === "tool";
  }

  private findMatchingAllowRule(request: ApprovalRequest): AllowRule | null {
    const rules = this.settings.allowRules;
    if (!Array.isArray(rules) || rules.length === 0) {
      return null;
    }

    const command = this.extractApprovalCommand(request);
    const toolName = this.extractApprovalToolName(request);
    const filePaths = this.extractApprovalFilePaths(request);

    for (const rule of rules) {
      if (rule.type === "command") {
        if (command && command.startsWith(rule.pattern)) {
          return rule;
        }
        continue;
      }

      if (rule.type === "file_write") {
        const normalizedRule = this.normalizeFilePathForRule(rule.pattern);
        const matched = filePaths.some((path) => this.normalizeFilePathForRule(path).startsWith(normalizedRule));
        if (matched) {
          return rule;
        }
        continue;
      }

      if (rule.type === "tool") {
        if (toolName && toolName.toLowerCase() === rule.pattern.toLowerCase()) {
          return rule;
        }
      }
    }

    return null;
  }

  private extractAllowRuleCandidate(request: ApprovalRequest): { type: AllowRuleType; pattern: string } | null {
    const command = this.extractApprovalCommand(request);
    if (command) {
      return { type: "command", pattern: command };
    }

    const filePath = this.extractApprovalFilePaths(request)[0];
    if (filePath) {
      return { type: "file_write", pattern: filePath };
    }

    const toolName = this.extractApprovalToolName(request);
    if (toolName) {
      return { type: "tool", pattern: toolName };
    }

    return null;
  }

  private extractApprovalCommand(request: ApprovalRequest): string {
    const direct = typeof request.command === "string" ? request.command.trim() : "";
    if (direct) {
      return direct;
    }
    const params = request.params as Record<string, unknown> | undefined;
    const fromParams = [
      params?.command,
      params?.cmd,
      (params?.input as Record<string, unknown> | undefined)?.command,
      (params?.request as Record<string, unknown> | undefined)?.command,
      (params?.request as Record<string, unknown> | undefined)?.cmd,
    ].find((value) => typeof value === "string");
    return typeof fromParams === "string" ? fromParams.trim() : "";
  }

  private extractApprovalFilePaths(request: ApprovalRequest): string[] {
    const paths: string[] = [];
    if (typeof request.filePath === "string" && request.filePath.trim()) {
      paths.push(request.filePath.trim());
    }
    const params = request.params as Record<string, unknown> | undefined;
    const directValues = [
      params?.path,
      params?.filePath,
      params?.targetPath,
      (params?.request as Record<string, unknown> | undefined)?.path,
      (params?.request as Record<string, unknown> | undefined)?.filePath,
      (params?.request as Record<string, unknown> | undefined)?.targetPath,
    ];
    for (const value of directValues) {
      if (typeof value === "string" && value.trim()) {
        paths.push(value.trim());
      }
    }
    const files = params?.files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (typeof file === "string" && file.trim()) {
          paths.push(file.trim());
          continue;
        }
        if (!file || typeof file !== "object") {
          continue;
        }
        const fileObj = file as Record<string, unknown>;
        const candidate = [fileObj.path, fileObj.filePath, fileObj.newPath, fileObj.oldPath]
          .find((value) => typeof value === "string" && value.trim().length > 0);
        if (typeof candidate === "string") {
          paths.push(candidate.trim());
        }
      }
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const key = path.trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(key);
    }
    return deduped;
  }

  private extractApprovalToolName(request: ApprovalRequest): string {
    const params = request.params as Record<string, unknown> | undefined;
    const candidate = [
      params?.tool,
      params?.toolName,
      params?.name,
      (params?.request as Record<string, unknown> | undefined)?.tool,
      (params?.request as Record<string, unknown> | undefined)?.toolName,
      (params?.request as Record<string, unknown> | undefined)?.name,
    ].find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof candidate === "string" ? candidate.trim() : "";
  }

  private normalizeFilePathForRule(path: string): string {
    return path
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/^\.\//, "")
      .toLowerCase();
  }

  private buildApprovalSummary(request: ApprovalRequest): string {
    const command = this.extractApprovalCommand(request);
    if (command) {
      return `${request.type} (${command.slice(0, 80)})`;
    }
    const filePath = this.extractApprovalFilePaths(request)[0];
    if (filePath) {
      return `${request.type} (${filePath})`;
    }
    const toolName = this.extractApprovalToolName(request);
    if (toolName) {
      return `${request.type} (${toolName})`;
    }
    return request.type;
  }
}

class CodexidianSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CodexidianPlugin) {
    super(app, plugin);
  }

  private createRuntimeStatusDescription(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const line of this.plugin.getRuntimeStatusLines()) {
      const lineEl = document.createElement("div");
      lineEl.textContent = line;
      fragment.appendChild(lineEl);
    }
    return fragment;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settingsTitle") });

    new Setting(containerEl)
      .setName(t("settingLanguageName"))
      .setDesc(t("settingLanguageDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh", t("localeNameZh"))
          .addOption("en", t("localeNameEn"))
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            if (!isLocale(value)) return;
            this.plugin.settings.locale = value;
            setLocale(value);
            await this.plugin.saveSettings();
            this.plugin.getOpenView()?.refreshLocale();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingCodexCommandName"))
      .setDesc(t("settingCodexCommandDesc"))
      .addText((text) => {
        text
          .setPlaceholder("codex.cmd")
          .setValue(this.plugin.settings.codexCommand);
        text.inputEl.addEventListener("change", () => {
          void (async () => {
            const nextValue = text.inputEl.value.trim() || DEFAULT_SETTINGS.codexCommand;
            if (nextValue === this.plugin.settings.codexCommand) {
              return;
            }
            this.plugin.settings.codexCommand = nextValue;
            try {
              await this.plugin.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true });
              await this.plugin.applyRuntimeSettingsChange({ restartClient: true });
              this.display();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          })();
        });
      });

    new Setting(containerEl)
      .setName(t("settingWorkingDirName"))
      .setDesc(t("settingWorkingDirDesc"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.getVaultBasePath())
          .setValue(this.plugin.settings.workingDirectory);
        text.inputEl.addEventListener("change", () => {
          void (async () => {
            const nextValue = text.inputEl.value.trim() || this.plugin.getVaultBasePath();
            if (nextValue === this.plugin.settings.workingDirectory) {
              return;
            }
            this.plugin.settings.workingDirectory = nextValue;
            try {
              await this.plugin.applyRuntimeSettingsChange({ restartClient: true });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          })();
        });
      });

    new Setting(containerEl)
      .setName(t("settingModelName"))
      .setDesc(t("settingModelDesc"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.getEffectiveModel() || "gpt-5.4")
          .setValue(this.plugin.settings.modelOverride);
        text.inputEl.addEventListener("change", () => {
          void (async () => {
            try {
              const normalized = await this.plugin.updateModelOverride(text.inputEl.value);
              text.setValue(normalized);
              this.display();
              new Notice(tf("noticeModelSet", { model: normalized || t("defaultModel") }));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          })();
        });
      });

    new Setting(containerEl)
      .setName(t("settingEffortName"))
      .setDesc(t("settingEffortDesc"))
      .addDropdown((dropdown) => {
        for (const e of EFFORT_OPTIONS) {
          dropdown.addOption(e.value, e.label);
        }
        dropdown
          .setValue(this.plugin.settings.thinkingEffort)
          .onChange(async (value) => {
            this.plugin.settings.thinkingEffort = value as any;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settingCollaborationModeName"))
      .setDesc(t("settingCollaborationModeDesc"))
      .addDropdown((dropdown) => {
        for (const mode of APPROVAL_MODES) {
          dropdown.addOption(mode.value, `${mode.label} (${mode.description})`);
        }
        dropdown
          .setValue(this.plugin.settings.approvalMode)
          .onChange(async (value) => {
            this.plugin.settings.approvalMode = isApprovalMode(value)
              ? value
              : DEFAULT_SETTINGS.approvalMode;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settingContextWindowName"))
      .setDesc(tf("settingContextWindowResolvedDesc", {
        compact: this.plugin.getEffectiveContextWindowDisplay(),
        exact: this.plugin.getEffectiveContextWindowExactDisplay(),
        source: this.plugin.getContextWindowSourceSummary(),
      }))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.getEffectiveContextWindowTokens().toString())
          .setValue(this.plugin.settings.contextWindowOverrideTokens?.toString() ?? "");
        text.inputEl.addEventListener("change", () => {
          void (async () => {
            try {
              const raw = text.inputEl.value.trim();
              const parsed = raw ? normalizeContextWindowOverride(Number(raw)) : null;
              if (raw && parsed === null) {
                throw new Error(t("contextWindowInvalid"));
              }
              const normalized = await this.plugin.updateContextWindowOverride(parsed);
              text.setValue(normalized?.toString() ?? "");
              this.display();
              new Notice(tf("noticeContextWindowSet", {
                size: normalized === null
                  ? this.plugin.getEffectiveContextWindowDisplay()
                  : formatTokenWindow(normalized),
              }));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          })();
        });
      });

    new Setting(containerEl)
      .setName(t("settingRuntimeStatusName"))
      .setDesc(this.createRuntimeStatusDescription())
      .addButton((button) => {
        button
          .setButtonText(t("settingRuntimeStatusRefresh"))
          .onClick(async () => {
            try {
              await this.plugin.refreshResolvedCliConfig({ queueRuntimeReset: true, restartClient: true });
              this.display();
              new Notice(t("noticeRuntimeStatusRefreshed"));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          });
      });

    containerEl.createEl("h3", { text: t("settingsAllowRulesSection") });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("settingsAllowRulesDesc"),
    });

    const rulesListEl = containerEl.createDiv({ cls: "codexidian-allow-rules-list" });
    const rules = [...this.plugin.settings.allowRules].sort((a, b) => b.createdAt - a.createdAt);
    if (rules.length === 0) {
      rulesListEl.createDiv({ cls: "codexidian-allow-rules-empty", text: t("allowRulesEmpty") });
    } else {
      for (const rule of rules) {
        const rowEl = rulesListEl.createDiv({ cls: "codexidian-allow-rule-item" });
        rowEl.createDiv({
          cls: "codexidian-allow-rule-meta",
          text: `${this.getAllowRuleTypeLabel(rule.type)}: ${rule.pattern}`,
        });
        const removeBtn = rowEl.createEl("button", {
          cls: "codexidian-allow-rule-remove",
          text: t("allowRuleDelete"),
        });
        removeBtn.type = "button";
        removeBtn.addEventListener("click", () => {
          void (async () => {
            try {
              this.plugin.settings.allowRules = this.plugin.settings.allowRules.filter((item) => item.id !== rule.id);
              await this.plugin.saveSettings();
              new Notice(t("noticeAllowRuleRemoved"));
              this.display();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeAllowRuleRemoveFailed", { error: message }));
            }
          })();
        });
      }
    }

    if (this.plugin.settings.allowRules.length > 0) {
      new Setting(containerEl)
        .setName(t("allowRulesClearAll"))
        .addButton((button) =>
          button.setButtonText(t("allowRulesClearAll")).onClick(() => {
            void (async () => {
              const confirmed = window.confirm(t("confirmAllowRulesClearAll"));
              if (!confirmed) return;
              try {
                this.plugin.settings.allowRules = [];
                await this.plugin.saveSettings();
                new Notice(t("noticeAllowRulesCleared"));
                this.display();
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(tf("noticeAllowRulesClearFailed", { error: message }));
              }
            })();
          }),
        );
    }

    new Setting(containerEl)
      .setName(t("settingApprovalPolicyName"))
      .setDesc(t("settingApprovalPolicyDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("on-request", "on-request")
          .addOption("never", "never")
          .addOption("untrusted", "untrusted")
          .addOption("on-failure", "on-failure")
          .setValue(this.plugin.settings.approvalPolicy)
          .onChange(async (value) => {
            this.plugin.settings.approvalPolicy = value as CodexidianSettings["approvalPolicy"];
            try {
              await this.plugin.applyRuntimeSettingsChange();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("settingSandboxName"))
      .setDesc(t("settingSandboxDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("workspace-write", "workspace-write")
          .addOption("read-only", "read-only")
          .addOption("danger-full-access", "danger-full-access")
          .setValue(this.plugin.settings.sandboxMode)
          .onChange(async (value) => {
            this.plugin.settings.sandboxMode = value as CodexidianSettings["sandboxMode"];
            try {
              await this.plugin.applyRuntimeSettingsChange();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(tf("noticeCodexError", { error: message }));
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("settingAutoApproveName"))
      .setDesc(t("settingAutoApproveDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveRequests).onChange(async (value) => {
          this.plugin.settings.autoApproveRequests = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingPersistThreadName"))
      .setDesc(t("settingPersistThreadDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.persistThread).onChange(async (value) => {
          this.plugin.settings.persistThread = value;
          if (!value) {
            this.plugin.settings.lastThreadId = "";
            this.plugin.client.setThreadId(null);
          }
          await this.plugin.saveSettings();
          this.plugin.refreshStatus();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingSavedThreadName"))
      .setDesc(this.plugin.settings.lastThreadId || t("settingSavedThreadEmpty"))
      .addButton((button) =>
        button.setButtonText(t("settingSavedThreadClear")).onClick(async () => {
          this.plugin.settings.lastThreadId = "";
          this.plugin.client.setThreadId(null);
          await this.plugin.saveSettings();
          this.display();
          this.plugin.refreshStatus();
          new Notice(t("noticeSavedThreadCleared"));
        }),
      );

    containerEl.createEl("h3", { text: t("settingsUiSection") });

    new Setting(containerEl)
      .setName(t("settingMaxTabsName"))
      .setDesc(t("settingMaxTabsDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.maxTabs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTabs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingContextInjectionName"))
      .setDesc(t("settingContextInjectionDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableContextInjection).onChange(async (value) => {
          this.plugin.settings.enableContextInjection = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingSelectionPollingName"))
      .setDesc(t("settingSelectionPollingDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableSelectionPolling).onChange(async (value) => {
          this.plugin.settings.enableSelectionPolling = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingEnableReviewPaneName"))
      .setDesc(t("settingEnableReviewPaneDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableReviewPane).onChange(async (value) => {
          this.plugin.settings.enableReviewPane = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: t("settingsMcpSection") });

    new Setting(containerEl)
      .setName(t("settingEnableMcpName"))
      .setDesc(t("settingEnableMcpDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableMcp).onChange(async (value) => {
          this.plugin.settings.enableMcp = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingMcpEndpointName"))
      .setDesc(t("settingMcpEndpointDesc"))
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:27124")
          .setValue(this.plugin.settings.mcpEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.mcpEndpoint = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingMcpApiKeyName"))
      .setDesc(t("settingMcpApiKeyDesc"))
      .addText((text) =>
        text
          .setPlaceholder("API key")
          .setValue(this.plugin.settings.mcpApiKey)
          .onChange(async (value) => {
            this.plugin.settings.mcpApiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingMcpContextLimitName"))
      .setDesc(t("settingMcpContextLimitDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 8, 1)
          .setValue(this.plugin.settings.mcpContextNoteLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mcpContextNoteLimit = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: t("settingsSecuritySection") });

    new Setting(containerEl)
      .setName(t("settingBlockedPathsName"))
      .setDesc(t("settingBlockedPathsDesc"))
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 6;
        textArea
          .setPlaceholder(".obsidian/\n.codex/\n.env\n*.secret")
          .setValue(this.plugin.settings.securityBlockedPaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.securityBlockedPaths = value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settingRequireApprovalWriteName"))
      .setDesc(t("settingRequireApprovalWriteDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.securityRequireApprovalForWrite).onChange(async (value) => {
          this.plugin.settings.securityRequireApprovalForWrite = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingMaxNoteSizeName"))
      .setDesc(t("settingMaxNoteSizeDesc"))
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.securityMaxNoteSize))
          .setValue(String(this.plugin.settings.securityMaxNoteSize))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value.trim(), 10);
            this.plugin.settings.securityMaxNoteSize = Number.isFinite(parsed) && parsed > 0
              ? parsed
              : DEFAULT_SETTINGS.securityMaxNoteSize;
            await this.plugin.saveSettings();
          }),
      );
  }

  private getAllowRuleTypeLabel(value: AllowRuleType): string {
    if (value === "command") return t("allowRuleTypeCommand");
    if (value === "file_write") return t("allowRuleTypeFileWrite");
    return t("allowRuleTypeTool");
  }
}
