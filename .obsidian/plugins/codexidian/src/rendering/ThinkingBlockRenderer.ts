export interface ThinkingBlockHandle {
  el: HTMLElement;
  appendContent: (text: string) => void;
  finalize: () => void;
}

export class ThinkingBlockRenderer {
  createBlock(container: HTMLElement): ThinkingBlockHandle {
    const blockEl = container.createEl("details", {
      cls: "codexidian-thinking-block codexidian-thinking-streaming",
    });
    const headerEl = blockEl.createEl("summary", {
      cls: "codexidian-thinking-header",
    });
    headerEl.createSpan({
      cls: "codexidian-thinking-title",
      text: "Thinking...",
    });
    const metaEl = headerEl.createSpan({
      cls: "codexidian-thinking-meta",
      text: "streaming",
    });

    const contentEl = blockEl.createEl("pre", {
      cls: "codexidian-thinking-content",
    });

    const startedAt = Date.now();
    let buffer = "";
    let done = false;

    return {
      el: blockEl,
      appendContent: (text: string) => {
        if (!text) return;
        buffer += text;
        contentEl.setText(buffer);
      },
      finalize: () => {
        if (done) return;
        done = true;
        blockEl.removeClass("codexidian-thinking-streaming");
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        metaEl.setText(`${elapsedSeconds}s`);
      },
    };
  }
}
