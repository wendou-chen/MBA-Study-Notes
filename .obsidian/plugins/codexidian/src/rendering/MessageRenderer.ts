import { MarkdownRenderer, type App, type Component } from "obsidian";
import { t } from "../i18n";

const DEBOUNCE_MS = 100;

export interface CodeApplyRequest {
  code: string;
  language: string;
  triggerEl: HTMLElement;
}

export class MessageRenderer {
  private debounceTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly app: App,
    private readonly component: Component,
    private readonly onApplyCode?: (request: CodeApplyRequest) => void | Promise<void>,
  ) {}

  /**
   * Render markdown content into a container element.
   * For assistant messages — full markdown with code block enhancements.
   */
  async renderContent(container: HTMLElement, content: string, sourcePath = ""): Promise<void> {
    container.empty();
    container.classList.add("codexidian-message-content");

    await MarkdownRenderer.renderMarkdown(content, container, sourcePath, this.component);

    this.enhanceCodeBlocks(container);
  }

  /**
   * Debounced render for streaming — accumulates text and re-renders at most every 100ms.
   */
  renderStreaming(container: HTMLElement, content: string, sourcePath = ""): void {
    const existing = this.debounceTimers.get(container);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(container);
      void this.renderContent(container, content, sourcePath);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(container, timer);
  }

  /**
   * Cancel any pending debounced renders (e.g., on view close).
   */
  destroy(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private enhanceCodeBlocks(container: HTMLElement): void {
    const pres = container.querySelectorAll("pre");
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (pre.parentElement?.classList.contains("codexidian-code-wrapper")) continue;

      const wrapper = document.createElement("div");
      wrapper.classList.add("codexidian-code-wrapper");

      // Extract language from code element class
      const code = pre.querySelector("code");
      let lang = "";
      if (code) {
        const cls = Array.from(code.classList).find((c) => c.startsWith("language-"));
        if (cls) {
          lang = cls.replace("language-", "");
        }
      }

      // Header with language label + copy button
      const header = document.createElement("div");
      header.classList.add("codexidian-code-header");

      const langLabel = document.createElement("span");
      langLabel.classList.add("codexidian-code-lang-label");
      langLabel.setText(lang || t("text"));
      header.appendChild(langLabel);

      const actions = document.createElement("div");
      actions.classList.add("codexidian-code-header-actions");

      const applyBtn = document.createElement("button");
      applyBtn.classList.add("codexidian-code-apply-btn");
      applyBtn.setText(t("apply"));
      applyBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = code?.textContent ?? pre.textContent ?? "";
        if (!text.trim()) return;
        if (!this.onApplyCode) return;
        void this.onApplyCode({
          code: text,
          language: lang || "text",
          triggerEl: applyBtn,
        });
      });
      actions.appendChild(applyBtn);

      const copyBtn = document.createElement("button");
      copyBtn.classList.add("codexidian-code-copy-btn");
      copyBtn.setText(t("copy"));
      copyBtn.addEventListener("click", () => {
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.setText(t("copied"));
          setTimeout(() => copyBtn.setText(t("copy")), 1500);
        });
      });
      actions.appendChild(copyBtn);
      header.appendChild(actions);

      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    }
  }
}
