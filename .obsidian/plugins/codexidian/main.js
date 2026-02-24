"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const CodexAppServerClient_1 = require("./CodexAppServerClient");
const CodexidianView_1 = require("./CodexidianView");
const types_1 = require("./types");
class CodexidianPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = { ...types_1.DEFAULT_SETTINGS };
    }
    async onload() {
        await this.loadSettings();
        this.client = new CodexAppServerClient_1.CodexAppServerClient(() => this.settings, () => this.getVaultBasePath(), (threadId) => {
            if (!this.settings.persistThread) {
                return;
            }
            this.settings.lastThreadId = threadId;
            void this.saveSettings();
        }, (message) => {
            const view = this.getOpenView();
            if (view) {
                view.appendSystemMessage(message);
                view.updateStatus();
            }
        });
        this.registerView(CodexidianView_1.VIEW_TYPE_CODEXIDIAN, (leaf) => new CodexidianView_1.CodexidianView(leaf, this));
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
                    new obsidian_1.Notice(`Codexidian new thread: ${threadId.slice(0, 8)}...`);
                    this.refreshStatus();
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    new obsidian_1.Notice(`Codexidian: ${message}`);
                }
            },
        });
        this.addSettingTab(new CodexidianSettingTab(this.app, this));
    }
    async onunload() {
        this.app.workspace.detachLeavesOfType(CodexidianView_1.VIEW_TYPE_CODEXIDIAN);
        if (this.client) {
            await this.client.dispose();
        }
    }
    getVaultBasePath() {
        const adapter = this.app.vault.adapter;
        if (adapter instanceof obsidian_1.FileSystemAdapter) {
            return adapter.getBasePath();
        }
        return process.cwd();
    }
    getOpenView() {
        const leaves = this.app.workspace.getLeavesOfType(CodexidianView_1.VIEW_TYPE_CODEXIDIAN);
        if (leaves.length === 0) {
            return null;
        }
        const view = leaves[0].view;
        if (view instanceof CodexidianView_1.CodexidianView) {
            return view;
        }
        return null;
    }
    refreshStatus() {
        const view = this.getOpenView();
        view === null || view === void 0 ? void 0 : view.updateStatus();
    }
    async activateView() {
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType(CodexidianView_1.VIEW_TYPE_CODEXIDIAN)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) {
                return;
            }
            await leaf.setViewState({ type: CodexidianView_1.VIEW_TYPE_CODEXIDIAN, active: true });
        }
        workspace.revealLeaf(leaf);
    }
    async loadSettings() {
        const loaded = (await this.loadData());
        this.settings = Object.assign({}, types_1.DEFAULT_SETTINGS, loaded !== null && loaded !== void 0 ? loaded : {});
        if (!this.settings.workingDirectory.trim()) {
            this.settings.workingDirectory = this.getVaultBasePath();
        }
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
}
exports.default = CodexidianPlugin;
class CodexidianSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Codexidian Settings" });
        new obsidian_1.Setting(containerEl)
            .setName("Codex command")
            .setDesc("CLI command used to launch app-server. Windows default: codex.cmd")
            .addText((text) => text
            .setPlaceholder("codex.cmd")
            .setValue(this.plugin.settings.codexCommand)
            .onChange(async (value) => {
            this.plugin.settings.codexCommand = value.trim() || types_1.DEFAULT_SETTINGS.codexCommand;
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Working directory")
            .setDesc("Root directory Codex uses for this plugin session.")
            .addText((text) => text
            .setPlaceholder(this.plugin.getVaultBasePath())
            .setValue(this.plugin.settings.workingDirectory)
            .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value.trim() || this.plugin.getVaultBasePath();
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Model override")
            .setDesc("Optional model name. Leave empty to use Codex defaults.")
            .addText((text) => text
            .setPlaceholder("e.g. gpt-5.2-codex")
            .setValue(this.plugin.settings.model)
            .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Approval policy")
            .setDesc("Codex ask-for-approval mode for new or resumed threads.")
            .addDropdown((dropdown) => dropdown
            .addOption("on-request", "on-request")
            .addOption("never", "never")
            .addOption("untrusted", "untrusted")
            .addOption("on-failure", "on-failure")
            .setValue(this.plugin.settings.approvalPolicy)
            .onChange(async (value) => {
            this.plugin.settings.approvalPolicy = value;
            await this.plugin.saveSettings();
            this.plugin.refreshStatus();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Sandbox mode")
            .setDesc("Sandbox mode for newly started or resumed threads.")
            .addDropdown((dropdown) => dropdown
            .addOption("workspace-write", "workspace-write")
            .addOption("read-only", "read-only")
            .addOption("danger-full-access", "danger-full-access")
            .setValue(this.plugin.settings.sandboxMode)
            .onChange(async (value) => {
            this.plugin.settings.sandboxMode = value;
            await this.plugin.saveSettings();
            this.plugin.refreshStatus();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Auto-approve app-server requests")
            .setDesc("If enabled, command/file approval callbacks are answered automatically.")
            .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoApproveRequests).onChange(async (value) => {
            this.plugin.settings.autoApproveRequests = value;
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Persist thread across restarts")
            .setDesc("Reuse the last thread id when possible.")
            .addToggle((toggle) => toggle.setValue(this.plugin.settings.persistThread).onChange(async (value) => {
            this.plugin.settings.persistThread = value;
            if (!value) {
                this.plugin.settings.lastThreadId = "";
                this.plugin.client.setThreadId(null);
            }
            await this.plugin.saveSettings();
            this.plugin.refreshStatus();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Saved thread")
            .setDesc(this.plugin.settings.lastThreadId || "(none)")
            .addButton((button) => button.setButtonText("Clear").onClick(async () => {
            this.plugin.settings.lastThreadId = "";
            this.plugin.client.setThreadId(null);
            await this.plugin.saveSettings();
            this.display();
            this.plugin.refreshStatus();
            new obsidian_1.Notice("Codexidian saved thread cleared.");
        }));
    }
}
