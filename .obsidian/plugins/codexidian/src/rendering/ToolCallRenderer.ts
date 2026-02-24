interface ToolCardInfo {
  type: string;
  name?: string;
  command?: string;
  filePath?: string;
}

export interface ToolCardHandle {
  el: HTMLElement;
  appendOutput: (text: string) => void;
  complete: (status: string) => void;
}

export class ToolCallRenderer {
  createCard(container: HTMLElement, info: ToolCardInfo): ToolCardHandle {
    const cardEl = container.createDiv({ cls: "codexidian-tool-card" });

    const headerEl = cardEl.createDiv({ cls: "codexidian-tool-header" });
    const iconEl = headerEl.createSpan({ cls: "codexidian-tool-icon", text: "⚙" });
    const titleEl = headerEl.createSpan({
      cls: "codexidian-tool-title",
      text: this.buildTitle(info),
    });
    const statusEl = headerEl.createSpan({
      cls: "codexidian-tool-status codexidian-tool-status-running",
      text: "⏳ running",
    });

    if (info.command) {
      cardEl.createDiv({
        cls: "codexidian-tool-command",
        text: info.command,
      });
    }

    if (info.filePath) {
      cardEl.createDiv({
        cls: "codexidian-tool-file",
        text: info.filePath,
      });
    }

    const outputDetailsEl = cardEl.createEl("details", {
      cls: "codexidian-tool-output-wrap",
    });
    outputDetailsEl.createEl("summary", {
      cls: "codexidian-tool-output-summary",
      text: "Output",
    });
    const outputEl = outputDetailsEl.createEl("pre", {
      cls: "codexidian-tool-output",
    });

    let outputBuffer = "";

    return {
      el: cardEl,
      appendOutput: (text: string) => {
        if (!text) return;
        outputBuffer += text;
        outputEl.setText(outputBuffer);
      },
      complete: (status: string) => {
        const normalized = status.trim().toLowerCase();
        statusEl.removeClass("codexidian-tool-status-running");
        statusEl.removeClass("codexidian-tool-status-done");
        statusEl.removeClass("codexidian-tool-status-error");

        if (this.isErrorStatus(normalized)) {
          statusEl.addClass("codexidian-tool-status-error");
          statusEl.setText(`✗ ${normalized || "failed"}`);
          iconEl.setText("✖");
          return;
        }

        if (this.isDoneStatus(normalized)) {
          statusEl.addClass("codexidian-tool-status-done");
          statusEl.setText(`✓ ${normalized || "done"}`);
          iconEl.setText("✓");
          return;
        }

        statusEl.addClass("codexidian-tool-status-running");
        statusEl.setText(`⏳ ${normalized || "running"}`);
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
    return "Tool";
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
