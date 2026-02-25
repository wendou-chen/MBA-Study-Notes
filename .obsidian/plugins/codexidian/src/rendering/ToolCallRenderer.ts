import { t } from "../i18n";

interface ToolCardInfo {
  type: string;
  name?: string;
  command?: string;
  filePath?: string;
}

export interface ToolCardHandle {
  el: HTMLElement;
  appendOutput: (text: string) => void;
  complete: (status: string, durationMs?: number) => void;
}

export class ToolCallRenderer {
  createCard(container: HTMLElement, info: ToolCardInfo): ToolCardHandle {
    const cardEl = container.createDiv({ cls: "codexidian-tool-card is-collapsed" });
    let collapsed = true;

    const headerEl = cardEl.createDiv({ cls: "codexidian-tool-header" });
    headerEl.setAttr("role", "button");
    headerEl.setAttr("tabindex", "0");
    headerEl.setAttr("aria-expanded", "false");
    const iconEl = headerEl.createSpan({ cls: "codexidian-tool-icon", text: "⚙" });
    const titleEl = headerEl.createSpan({
      cls: "codexidian-tool-title",
      text: this.buildTitle(info),
    });
    const statusEl = headerEl.createSpan({
      cls: "codexidian-tool-status codexidian-tool-status-running",
      text: `⏳ ${t("statusRunningShort")}`,
    });
    const durationEl = headerEl.createSpan({
      cls: "codexidian-tool-duration",
      text: "",
    });

    const bodyEl = cardEl.createDiv({ cls: "codexidian-tool-body" });

    if (info.command) {
      bodyEl.createDiv({
        cls: "codexidian-tool-command",
        text: info.command,
      });
    }

    if (info.filePath) {
      bodyEl.createDiv({
        cls: "codexidian-tool-file",
        text: info.filePath,
      });
    }

    const outputDetailsEl = bodyEl.createDiv({
      cls: "codexidian-tool-output-wrap",
    });
    outputDetailsEl.createDiv({
      cls: "codexidian-tool-output-summary",
      text: t("output"),
    });
    const outputEl = outputDetailsEl.createEl("pre", {
      cls: "codexidian-tool-output",
    });
    outputDetailsEl.addClass("is-empty");

    let outputBuffer = "";
    const setCollapsed = (next: boolean): void => {
      collapsed = next;
      cardEl.toggleClass("is-collapsed", next);
      headerEl.setAttr("aria-expanded", String(!next));
    };
    const toggleCollapsed = (): void => {
      setCollapsed(!collapsed);
    };
    headerEl.addEventListener("click", () => {
      toggleCollapsed();
    });
    headerEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      toggleCollapsed();
    });

    return {
      el: cardEl,
      appendOutput: (text: string) => {
        if (!text) return;
        outputBuffer += text;
        outputEl.setText(outputBuffer);
        outputDetailsEl.removeClass("is-empty");
      },
      complete: (status: string, durationMs?: number) => {
        const normalized = status.trim().toLowerCase();
        statusEl.removeClass("codexidian-tool-status-running");
        statusEl.removeClass("codexidian-tool-status-done");
        statusEl.removeClass("codexidian-tool-status-error");
        const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0;
        durationEl.setText(hasDuration ? `${Math.round(durationMs)}ms` : "");

        if (this.isErrorStatus(normalized)) {
          statusEl.addClass("codexidian-tool-status-error");
          statusEl.setText(`✗ ${normalized || t("statusFailedShort")}`);
          iconEl.setText("✖");
          return;
        }

        if (this.isDoneStatus(normalized)) {
          statusEl.addClass("codexidian-tool-status-done");
          statusEl.setText(`✓ ${normalized || t("statusDoneShort")}`);
          iconEl.setText("✓");
          return;
        }

        statusEl.addClass("codexidian-tool-status-running");
        statusEl.setText(`⏳ ${normalized || t("statusRunningShort")}`);
        iconEl.setText("⚙");
        titleEl.setText(this.buildTitle(info));
      },
    };
  }

  private buildTitle(info: ToolCardInfo): string {
    if (info.name && info.name.trim().length > 0) {
      return info.name.trim();
    }
    if (info.type && info.type.trim().length > 0) {
      return info.type.trim();
    }
    return t("toolTitle");
  }

  private isDoneStatus(status: string): boolean {
    return (
      status === "completed"
      || status === "complete"
      || status === "success"
      || status === "ok"
      || status === "done"
    );
  }

  private isErrorStatus(status: string): boolean {
    return (
      status.includes("error")
      || status.includes("fail")
      || status.includes("deny")
      || status.includes("reject")
      || status.includes("cancel")
      || status.includes("interrupted")
    );
  }
}
