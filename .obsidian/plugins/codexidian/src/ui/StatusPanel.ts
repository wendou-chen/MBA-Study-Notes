import type { StatusEntry, TurnStatus } from "../types";

type StatusEntryInput = Omit<StatusEntry, "timestamp">;

export class StatusPanel {
  private readonly containerEl: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly entriesEl: HTMLElement;
  private readonly arrowEl: HTMLElement;
  private collapsed = false;
  private entries: StatusEntry[] = [];
  private turnStatus: TurnStatus = "idle";
  private cleanupTimer: number | null = null;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.containerEl.addClass("codexidian-status-panel");
    this.headerEl = this.containerEl.createDiv({ cls: "codexidian-status-header" });
    this.currentEl = this.headerEl.createDiv({ cls: "codexidian-status-current", text: "Idle" });
    this.arrowEl = this.headerEl.createSpan({ cls: "status-arrow", text: "▾" });
    this.entriesEl = this.containerEl.createDiv({ cls: "codexidian-status-entries" });

    this.headerEl.addEventListener("click", () => this.toggleCollapsed());

    this.render();
  }

  setTurnStatus(status: TurnStatus): void {
    this.turnStatus = status;
    if (status === "idle") {
      this.clearFinishedAfterDelay(3000);
    }
    this.render();
  }

  addEntry(entry: StatusEntryInput): void {
    const normalized: StatusEntry = {
      ...entry,
      detail: this.normalizeDetail(entry.detail),
      timestamp: Date.now(),
    };

    const existingIndex = this.entries.findIndex((candidate) => candidate.id === normalized.id);
    if (existingIndex >= 0) {
      const existing = this.entries[existingIndex];
      this.entries[existingIndex] = {
        ...existing,
        ...normalized,
        timestamp: existing.timestamp,
      };
    } else {
      this.entries.push(normalized);
    }

    this.entries.sort((a, b) => b.timestamp - a.timestamp);
    if (this.entries.length > 5) {
      this.entries = this.entries.slice(0, 5);
    }

    this.render();
  }

  updateEntry(
    id: string,
    patch: Partial<StatusEntry>,
  ): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;

    const current = this.entries[index];
    const nextStatus = patch.status ?? current.status;
    const nextDuration = patch.duration
      ?? (nextStatus === "running" ? current.duration : (Date.now() - current.timestamp));

    this.entries[index] = {
      ...current,
      ...patch,
      id: current.id,
      timestamp: current.timestamp,
      detail: this.normalizeDetail(patch.detail ?? current.detail),
      duration: nextDuration,
      status: nextStatus,
    };

    this.render();
  }

  clearFinishedAfterDelay(delayMs = 3000): void {
    if (this.cleanupTimer !== null) {
      window.clearTimeout(this.cleanupTimer);
    }
    this.cleanupTimer = window.setTimeout(() => {
      this.cleanupTimer = null;
      this.entries = this.entries.filter((entry) => entry.status === "running");
      this.render();
    }, delayMs);
  }

  clear(): void {
    this.entries = [];
    if (this.cleanupTimer !== null) {
      window.clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.render();
  }

  destroy(): void {
    if (this.cleanupTimer !== null) {
      window.clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.containerEl.empty();
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  private render(): void {
    const statusText = this.getCurrentStatusText();
    this.currentEl.setText(statusText);
    this.currentEl.toggleClass("is-active", this.turnStatus !== "idle");

    this.containerEl.toggleClass("is-collapsed", this.collapsed);
    this.arrowEl.setText(this.collapsed ? "▸" : "▾");
    this.renderEntries();

    const visible = this.turnStatus !== "idle" || this.entries.length > 0;
    this.containerEl.toggleClass("is-active", visible);
  }

  private renderEntries(): void {
    this.entriesEl.empty();
    for (const entry of this.entries) {
      const rowEl = this.entriesEl.createDiv({
        cls: `codexidian-status-entry codexidian-status-entry--${entry.status}`,
      });

      rowEl.createSpan({ cls: "codexidian-status-entry-icon", text: this.statusIcon(entry.status) });
      rowEl.createSpan({ cls: "entry-label", text: this.entryTypeLabel(entry.type) });

      const detailEl = rowEl.createSpan({ cls: "entry-detail" });
      const detailText = entry.detail ? `${entry.label}: ${entry.detail}` : entry.label;
      detailEl.setText(detailText);
      detailEl.title = detailText;

      if (entry.status !== "running") {
        rowEl.createSpan({
          cls: "entry-duration",
          text: this.formatDuration(entry.duration),
        });
      }
    }
  }

  private getCurrentStatusText(): string {
    if (this.turnStatus === "idle") {
      return "Idle";
    }
    if (this.turnStatus === "thinking") {
      return "Thinking...";
    }
    if (this.turnStatus === "streaming") {
      return "Streaming response...";
    }
    if (this.turnStatus === "waiting_approval") {
      return "Waiting for approval...";
    }

    const activeTool = this.entries.find((entry) => entry.type === "tool_call" && entry.status === "running");
    if (activeTool) {
      return "Running tool...";
    }
    return "Running...";
  }

  private entryTypeLabel(type: StatusEntry["type"]): string {
    if (type === "tool_call") return "TOOL";
    if (type === "thinking") return "THINK";
    if (type === "subagent") return "AGENT";
    return "INFO";
  }

  private statusIcon(status: StatusEntry["status"]): string {
    if (status === "running") return "⏳";
    if (status === "completed") return "✅";
    return "❌";
  }

  private formatDuration(duration?: number): string {
    if (!duration || duration < 0) return "";
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  }

  private normalizeDetail(detail?: string): string | undefined {
    if (!detail) return undefined;
    const compact = detail.replace(/\s+/g, " ").trim();
    if (!compact) return undefined;
    if (compact.length <= 80) return compact;
    return `${compact.slice(0, 80)}...`;
  }
}
