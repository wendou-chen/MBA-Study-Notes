import type { App } from "obsidian";

/**
 * Wraps app.vault.adapter for all file I/O — no Node fs usage.
 */
export class VaultFileAdapter {
  constructor(private readonly app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async write(path: string, data: string): Promise<void> {
    await this.app.vault.adapter.write(path, data);
  }

  async delete(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    if (!(await this.exists(dir))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(dir);
    return listing.files;
  }

  async ensureFolder(path: string): Promise<void> {
    if (!(await this.exists(path))) {
      await this.app.vault.adapter.mkdir(path);
    }
  }
}
