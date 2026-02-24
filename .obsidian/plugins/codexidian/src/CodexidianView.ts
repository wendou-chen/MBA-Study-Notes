import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import type CodexidianPlugin from "./main";

export const VIEW_TYPE_CODEXIDIAN = "codexidian-view";

export class CodexidianView extends ItemView {
  private rootEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private newThreadBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;

  private running = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CodexidianPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CODEXIDIAN;
  }

  getDisplayText(): string {
    return "Codexidian";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    this.rootEl = container.createDiv({ cls: "codexidian-view" });

    const headerEl = this.rootEl.createDiv({ cls: "codexidian-header" });
    const headerLeft = headerEl.createDiv({ cls: "codexidian-header-left" });
    headerLeft.createDiv({ cls: "codexidian-title", text: "Codexidian" });
    this.statusEl = headerLeft.createDiv({ cls: "codexidian-status", text: "Disconnected" });

    const headerRight = headerEl.createDiv({ cls: "codexidian-header-right" });
    this.newThreadBtn = headerRight.createEl("button", { text: "New Thread" });
    this.restartBtn = headerRight.createEl("button", { text: "Restart" });

    this.messagesEl = this.rootEl.createDiv({ cls: "codexidian-messages" });

    const footerEl = this.rootEl.createDiv({ cls: "codexidian-footer" });
    this.inputEl = footerEl.createEl("textarea", { cls: "codexidian-input" });
    this.inputEl.placeholder = "Ask Codex about this vault...";

    const actionsEl = footerEl.createDiv({ cls: "codexidian-actions" });
    actionsEl.createDiv({ cls: "codexidian-hint", text: "Ctrl/Cmd+Enter to send" });
    this.sendBtn = actionsEl.createEl("button", { text: "Send" });

    this.bindEvents();
    this.updateStatus();

    this.appendSystemMessage("Ready. Click Send to start Codex in this pane.");
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener("click", () => {
      void this.sendCurrentInput();
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.sendCurrentInput();
      }
    });

    this.newThreadBtn.addEventListener("click", () => {
      void this.startNewThread();
    });

    this.restartBtn.addEventListener("click", () => {
      void this.restartEngine();
    });
  }

  private async sendCurrentInput(): Promise<void> {
    const prompt = this.inputEl.value.trim();
    if (!prompt || this.running) {
      return;
    }

    this.inputEl.value = "";
    this.appendMessage("user", prompt);

    const assistantEl = this.appendMessage("assistant", "");

    this.running = true;
    this.updateStatus();

    try {
      const result = await this.plugin.client.sendTurn(prompt, {
        onDelta: (delta) => {
          assistantEl.setText((assistantEl.textContent ?? "") + delta);
          this.scrollToBottom();
        },
        onToolDelta: (delta) => {
          // Keep tool output lightweight in chat body to avoid overwhelming the pane.
          if (delta.trim().length > 0) {
            this.statusEl.setText(`Tool output: ${delta.trim().slice(0, 80)}`);
          }
        },
        onSystem: (message) => {
          this.appendSystemMessage(message);
        },
      });

      if ((assistantEl.textContent ?? "").trim().length === 0) {
        if (result.errorMessage) {
          assistantEl.setText(result.errorMessage);
        } else {
          assistantEl.setText("(No assistant text output)");
        }
      }

      if (result.status !== "completed") {
        const suffix = result.errorMessage ? `: ${result.errorMessage}` : "";
        this.appendSystemMessage(`Turn finished with status ${result.status}${suffix}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assistantEl.setText("(No assistant output)");
      this.appendSystemMessage(`Request failed: ${message}`);
      new Notice(`Codexidian: ${message}`);
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  private async startNewThread(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.updateStatus();

    try {
      const threadId = await this.plugin.client.newThread();
      this.appendSystemMessage(`Started new thread: ${threadId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessage(`Failed to start new thread: ${message}`);
      new Notice(`Codexidian: ${message}`);
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  private async restartEngine(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.updateStatus();

    try {
      await this.plugin.client.restart();
      this.appendSystemMessage("Codex app-server restarted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendSystemMessage(`Restart failed: ${message}`);
      new Notice(`Codexidian: ${message}`);
    } finally {
      this.running = false;
      this.updateStatus();
    }
  }

  appendSystemMessage(message: string): void {
    this.appendMessage("system", message);
  }

  private appendMessage(role: "user" | "assistant" | "system", text: string): HTMLElement {
    const el = this.messagesEl.createDiv({ cls: `codexidian-msg codexidian-msg-${role}` });
    el.setText(text);
    this.scrollToBottom();
    return el;
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  updateStatus(): void {
    const settings = this.plugin.settings;
    const threadId = this.plugin.client.getThreadId();
    const runningText = this.running ? "Running" : "Idle";
    const threadText = threadId ? `thread ${threadId.slice(0, 8)}...` : "no thread";

    this.statusEl.setText(
      `${runningText} | ${threadText} | ${settings.approvalPolicy} | ${settings.sandboxMode}`
    );

    const disabled = this.running;
    this.sendBtn.disabled = disabled;
    this.newThreadBtn.disabled = disabled;
    this.restartBtn.disabled = disabled;
    this.inputEl.disabled = disabled;
  }
}
