import type { VaultFileAdapter } from "./VaultFileAdapter";
import type {
  ChatMessage,
  Conversation,
  ConversationListFilter,
  ConversationMeta,
} from "../types";

const SESSIONS_DIR = ".codexidian/sessions";

export class SessionStorage {
  constructor(private readonly adapter: VaultFileAdapter) {}

  async init(): Promise<void> {
    await this.adapter.ensureFolder(".codexidian");
    await this.adapter.ensureFolder(SESSIONS_DIR);
  }

  private filePath(id: string): string {
    return `${SESSIONS_DIR}/${id}.jsonl`;
  }

  async saveConversation(conv: Conversation): Promise<void> {
    const tags = this.normalizeTags(conv.tags);
    const meta: Record<string, unknown> = {
      type: "meta",
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lastResponseAt: conv.lastResponseAt,
      threadId: conv.threadId,
      archived: conv.archived === true,
      pinned: conv.pinned === true,
      tags: tags.length > 0 ? tags : undefined,
    };
    const lines: string[] = [JSON.stringify(meta)];
    for (const msg of conv.messages) {
      lines.push(JSON.stringify({ type: "message", message: msg }));
    }
    await this.adapter.write(this.filePath(conv.id), lines.join("\n") + "\n");
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const path = this.filePath(id);
    if (!(await this.adapter.exists(path))) return null;

    const raw = await this.adapter.read(path);
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    const metaLine = this.parseJsonRecord(lines[0]);
    if (!metaLine || metaLine.type !== "meta") return null;
    const messages: ChatMessage[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parsed = this.parseJsonRecord(lines[i]);
      if (parsed?.type === "message" && parsed.message) {
        messages.push(parsed.message as ChatMessage);
      }
    }

    const normalizedId = this.readString(metaLine.id)?.trim() || id;
    const normalizedTitle = this.readString(metaLine.title)?.trim() || normalizedId;
    const createdAt = this.readNumber(metaLine.createdAt) ?? Date.now();
    const updatedAt = this.readNumber(metaLine.updatedAt) ?? createdAt;
    const lastResponseAt = this.readNumber(metaLine.lastResponseAt) ?? undefined;
    const threadId = this.readString(metaLine.threadId)?.trim() || undefined;
    const archived = this.readBoolean(metaLine.archived) ?? false;
    const pinned = this.readBoolean(metaLine.pinned) ?? false;
    const tags = this.normalizeTags(metaLine.tags);

    return {
      id: normalizedId,
      title: normalizedTitle,
      createdAt,
      updatedAt,
      lastResponseAt,
      threadId,
      archived,
      pinned,
      tags,
      messages,
    };
  }

  async updateMeta(
    id: string,
    partial: Partial<Pick<ConversationMeta, "archived" | "pinned" | "tags">>,
  ): Promise<ConversationMeta | null> {
    const path = this.filePath(id);
    if (!(await this.adapter.exists(path))) {
      return null;
    }

    const raw = await this.adapter.read(path);
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }

    const metaLine = this.parseJsonRecord(lines[0]);
    if (!metaLine || metaLine.type !== "meta") {
      return null;
    }

    if (partial.archived !== undefined) {
      metaLine.archived = Boolean(partial.archived);
    }
    if (partial.pinned !== undefined) {
      metaLine.pinned = Boolean(partial.pinned);
    }
    if (partial.tags !== undefined) {
      const normalizedTags = this.normalizeTags(partial.tags);
      if (normalizedTags.length > 0) {
        metaLine.tags = normalizedTags;
      } else {
        delete metaLine.tags;
      }
    }
    metaLine.updatedAt = Date.now();

    lines[0] = JSON.stringify(metaLine);
    await this.adapter.write(path, `${lines.join("\n")}\n`);

    const parsed = this.parseMetaFromRaw(path, lines.join("\n"), false);
    return parsed?.meta ?? null;
  }

  async deleteConversation(id: string): Promise<void> {
    await this.adapter.delete(this.filePath(id));
  }

  async listConversations(filter: ConversationListFilter = "all"): Promise<ConversationMeta[]> {
    const parsed = await this.collectMetas(false);
    return this.filterAndSortMetas(parsed.map((entry) => entry.meta), filter);
  }

  async searchConversations(
    query: string,
    filter: ConversationListFilter = "all",
  ): Promise<ConversationMeta[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return this.listConversations(filter);
    }

    const parsed = await this.collectMetas(true);
    const matched = parsed
      .filter((entry) => {
        const titleHit = entry.meta.title.toLowerCase().includes(normalizedQuery);
        const previewHit = entry.meta.preview.toLowerCase().includes(normalizedQuery);
        const textHit = (entry.searchTextLower ?? "").includes(normalizedQuery);
        return titleHit || previewHit || textHit;
      })
      .map((entry) => entry.meta);

    return this.filterAndSortMetas(matched, filter);
  }

  private async collectMetas(includeSearchText: boolean): Promise<Array<{
    meta: ConversationMeta;
    searchTextLower?: string;
  }>> {
    const files = await this.adapter.listFiles(SESSIONS_DIR);
    const parsedMetas: Array<{ meta: ConversationMeta; searchTextLower?: string }> = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const raw = await this.adapter.read(file);
        const parsed = this.parseMetaFromRaw(file, raw, includeSearchText);
        if (parsed) {
          parsedMetas.push(parsed);
        }
      } catch {
        // Skip malformed files.
      }
    }

    return parsedMetas;
  }

  private parseMetaFromRaw(
    filePath: string,
    raw: string,
    includeSearchText: boolean,
  ): { meta: ConversationMeta; searchTextLower?: string } | null {
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }

    const firstLine = this.parseJsonRecord(lines[0]);
    if (!firstLine || firstLine.type !== "meta") {
      return null;
    }

    const fallbackId = filePath.split("/").pop()?.replace(/\.jsonl$/, "") || filePath;
    const id = this.readString(firstLine.id)?.trim() || fallbackId;
    const title = this.readString(firstLine.title)?.trim() || id;
    const createdAt = this.readNumber(firstLine.createdAt) ?? Date.now();
    const updatedAt = this.readNumber(firstLine.updatedAt) ?? createdAt;
    const lastResponseAt = this.readNumber(firstLine.lastResponseAt) ?? undefined;
    const threadId = this.readString(firstLine.threadId)?.trim() || undefined;
    const archived = this.readBoolean(firstLine.archived) ?? false;
    const pinned = this.readBoolean(firstLine.pinned) ?? false;
    const tags = this.normalizeTags(firstLine.tags);

    let messageCount = 0;
    let preview = "";
    const searchParts: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parsed = this.parseJsonRecord(lines[i]);
      if (!parsed || parsed.type !== "message" || !parsed.message) {
        continue;
      }
      messageCount++;
      const content = this.readString((parsed.message as Record<string, unknown>).content) ?? "";
      if (content) {
        preview = content.slice(0, 80);
        if (includeSearchText) {
          searchParts.push(content);
        }
      }
    }

    const meta: ConversationMeta = {
      id,
      title,
      createdAt,
      updatedAt,
      lastResponseAt,
      threadId,
      archived,
      pinned,
      tags,
      messageCount,
      preview,
    };

    if (!includeSearchText) {
      return { meta };
    }
    return { meta, searchTextLower: searchParts.join("\n").toLowerCase() };
  }

  private filterAndSortMetas(
    metas: ConversationMeta[],
    filter: ConversationListFilter,
  ): ConversationMeta[] {
    const filtered = metas.filter((meta) => {
      if (filter === "active") {
        return !meta.archived;
      }
      if (filter === "archived") {
        return meta.archived === true;
      }
      if (filter === "pinned") {
        return meta.pinned === true;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinDelta !== 0) return pinDelta;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }

  private parseJsonRecord(line: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private readBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
  }

  private normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const unique = new Set<string>();
    for (const tag of value) {
      if (typeof tag !== "string") continue;
      const normalized = tag.trim();
      if (!normalized) continue;
      unique.add(normalized);
    }
    return Array.from(unique);
  }
}
