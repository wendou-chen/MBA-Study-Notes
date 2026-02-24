import type { SlashCommand } from "../types";

const MAX_VISIBLE_COMMANDS = 8;

export class SlashCommandMenu {
  private readonly menuEl: HTMLElement;
  private commands: SlashCommand[] = [];
  private filteredCommands: SlashCommand[] = [];
  private selectedIndex = 0;
  private visible = false;

  constructor(containerEl: HTMLElement) {
    this.menuEl = containerEl.createDiv({ cls: "codexidian-slash-menu" });
  }

  registerCommand(command: SlashCommand): void {
    const normalizedName = this.normalizeName(command.name);
    if (!normalizedName) {
      return;
    }

    const normalized: SlashCommand = {
      ...command,
      name: normalizedName,
    };

    const existingIndex = this.commands.findIndex((entry) => entry.name === normalizedName);
    if (existingIndex >= 0) {
      this.commands[existingIndex] = normalized;
    } else {
      this.commands.push(normalized);
    }
  }

  getCommands(): SlashCommand[] {
    return this.commands.map((command) => ({ ...command }));
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(filter: string): void {
    const normalizedFilter = filter.trim().toLowerCase();
    this.filteredCommands = this.commands
      .filter((command) => this.matchesFilter(command, normalizedFilter))
      .slice(0, MAX_VISIBLE_COMMANDS);

    if (this.filteredCommands.length === 0) {
      this.hide();
      return;
    }

    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = 0;
    }

    this.visible = true;
    this.menuEl.addClass("is-visible");
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.filteredCommands = [];
    this.selectedIndex = 0;
    this.menuEl.removeClass("is-visible");
    this.menuEl.empty();
  }

  selectNext(): void {
    if (!this.visible || this.filteredCommands.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
    this.render();
  }

  selectPrev(): void {
    if (!this.visible || this.filteredCommands.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
    this.render();
  }

  async executeSelected(): Promise<boolean> {
    if (!this.visible || this.filteredCommands.length === 0) {
      return false;
    }
    return await this.executeByIndex(this.selectedIndex);
  }

  async executeByName(name: string): Promise<boolean> {
    const normalizedName = this.normalizeName(name);
    if (!normalizedName) {
      return false;
    }

    const command = this.commands.find((entry) => entry.name === normalizedName);
    if (!command) {
      return false;
    }

    try {
      await command.execute();
    } finally {
      this.hide();
    }
    return true;
  }

  destroy(): void {
    this.hide();
    this.commands = [];
    this.menuEl.remove();
  }

  private render(): void {
    this.menuEl.empty();

    this.filteredCommands.forEach((command, index) => {
      const itemEl = this.menuEl.createDiv({ cls: "codexidian-slash-item" });
      if (index === this.selectedIndex) {
        itemEl.addClass("is-selected");
      }

      const displayName = command.icon
        ? `${command.icon} /${command.name}`
        : `/${command.name}`;
      itemEl.createDiv({
        cls: "codexidian-slash-item-name",
        text: displayName,
      });
      itemEl.createDiv({
        cls: "codexidian-slash-item-desc",
        text: command.description || command.label,
      });

      itemEl.addEventListener("mouseenter", () => {
        this.selectedIndex = index;
        this.render();
      });
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        void this.executeByIndex(index);
      });
    });
  }

  private async executeByIndex(index: number): Promise<boolean> {
    const command = this.filteredCommands[index];
    if (!command) {
      return false;
    }

    try {
      await command.execute();
    } finally {
      this.hide();
    }
    return true;
  }

  private matchesFilter(command: SlashCommand, filter: string): boolean {
    if (!filter) {
      return true;
    }
    const name = command.name.toLowerCase();
    const label = command.label.toLowerCase();
    const description = command.description.toLowerCase();
    return (
      name.includes(filter)
      || label.includes(filter)
      || description.includes(filter)
    );
  }

  private normalizeName(name: string): string {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  }
}
