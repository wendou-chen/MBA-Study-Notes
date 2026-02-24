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
import { CodexidianView, VIEW_TYPE_CODEXIDIAN } from "./CodexidianView";
import {
  DEFAULT_SETTINGS,
  type ApprovalDecision,
  type ApprovalRequest,
  AVAILABLE_MODELS,
  type CodexidianSettings,
  EFFORT_OPTIONS,
  type UserInputRequest,
  type UserInputResponse,
} from "./types";

export default class CodexidianPlugin extends Plugin {
  settings: CodexidianSettings = { ...DEFAULT_SETTINGS };
  client!: CodexAppServerClient;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.client = new CodexAppServerClient(
      () => this.settings,
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
    );

    this.registerView(
      VIEW_TYPE_CODEXIDIAN,
      (leaf: WorkspaceLeaf) => new CodexidianView(leaf, this),
    );

    this.addRibbonIcon("bot", "Open Codexidian", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-codexidian",
      name: "Open Codexidian",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "codexidian-new-thread",
      name: "Codexidian: Start New Thread",
      callback: async () => {
        try {
          const threadId = await this.client.newThread();
          new Notice(`Codexidian new thread: ${threadId.slice(0, 8)}...`);
          this.refreshStatus();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Codexidian: ${message}`);
        }
      },
    });

    this.addSettingTab(new CodexidianSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
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

  private getOpenView(): CodexidianView | null {
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

  private async handleApprovalRequest(request: ApprovalRequest): Promise<ApprovalDecision> {
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

  refreshStatus(): void {
    const view = this.getOpenView();
    view?.updateStatus();
  }

  async activateView(): Promise<void> {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CODEXIDIAN)[0];

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
    const loaded = (await this.loadData()) as Partial<CodexidianSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});

    if (!this.settings.workingDirectory.trim()) {
      this.settings.workingDirectory = this.getVaultBasePath();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class CodexidianSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CodexidianPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Codexidian Settings" });

    new Setting(containerEl)
      .setName("Codex command")
      .setDesc("CLI command used to launch app-server. Windows default: codex.cmd")
      .addText((text) =>
        text
          .setPlaceholder("codex.cmd")
          .setValue(this.plugin.settings.codexCommand)
          .onChange(async (value) => {
            this.plugin.settings.codexCommand = value.trim() || DEFAULT_SETTINGS.codexCommand;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Root directory Codex uses for this plugin session.")
      .addText((text) =>
        text
          .setPlaceholder(this.plugin.getVaultBasePath())
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value.trim() || this.plugin.getVaultBasePath();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Select the AI model for Codex sessions.")
      .addDropdown((dropdown) => {
        for (const m of AVAILABLE_MODELS) {
          dropdown.addOption(m.value, m.label);
        }
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Thinking effort")
      .setDesc("Control how deeply Codex thinks before responding.")
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
      .setName("Approval policy")
      .setDesc("Codex ask-for-approval mode for new or resumed threads.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("on-request", "on-request")
          .addOption("never", "never")
          .addOption("untrusted", "untrusted")
          .addOption("on-failure", "on-failure")
          .setValue(this.plugin.settings.approvalPolicy)
          .onChange(async (value) => {
            this.plugin.settings.approvalPolicy = value as CodexidianSettings["approvalPolicy"];
            await this.plugin.saveSettings();
            this.plugin.refreshStatus();
          }),
      );

    new Setting(containerEl)
      .setName("Sandbox mode")
      .setDesc("Sandbox mode for newly started or resumed threads.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("workspace-write", "workspace-write")
          .addOption("read-only", "read-only")
          .addOption("danger-full-access", "danger-full-access")
          .setValue(this.plugin.settings.sandboxMode)
          .onChange(async (value) => {
            this.plugin.settings.sandboxMode = value as CodexidianSettings["sandboxMode"];
            await this.plugin.saveSettings();
            this.plugin.refreshStatus();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-approve app-server requests")
      .setDesc("If enabled, command/file approval callbacks are answered automatically.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveRequests).onChange(async (value) => {
          this.plugin.settings.autoApproveRequests = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Persist thread across restarts")
      .setDesc("Reuse the last thread id when possible.")
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
      .setName("Saved thread")
      .setDesc(this.plugin.settings.lastThreadId || "(none)")
      .addButton((button) =>
        button.setButtonText("Clear").onClick(async () => {
          this.plugin.settings.lastThreadId = "";
          this.plugin.client.setThreadId(null);
          await this.plugin.saveSettings();
          this.display();
          this.plugin.refreshStatus();
          new Notice("Codexidian saved thread cleared.");
        }),
      );

    containerEl.createEl("h3", { text: "UI Settings" });

    new Setting(containerEl)
      .setName("Max tabs")
      .setDesc("Maximum number of open tabs (1-5).")
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
      .setName("Context injection")
      .setDesc("Inject current note path and editor selection into prompts.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableContextInjection).onChange(async (value) => {
          this.plugin.settings.enableContextInjection = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Selection polling")
      .setDesc("Poll editor selection to show context indicator.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableSelectionPolling).onChange(async (value) => {
          this.plugin.settings.enableSelectionPolling = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
