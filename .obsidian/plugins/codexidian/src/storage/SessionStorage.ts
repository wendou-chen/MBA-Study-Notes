import type { VaultFileAdapter } from "./VaultFileAdapter";
import type { Conversation, ConversationMeta, ChatMessage } from "../types";

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
    const meta: any = {
      type: "meta",
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lastResponseAt: conv.lastResponseAt,
      threadId: conv.threadId,
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

    const metaLine = JSON.parse(lines[0]);
    const messages: ChatMessage[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.type === "message" && parsed.message) {
          messages.push(parsed.message);
        }
      } catch { /* skip malformed lines */ }
    }

    return {
      id: metaLine.id,
      title: metaLine.title,
      createdAt: metaLine.createdAt,
      updatedAt: metaLine.updatedAt,
      lastResponseAt: metaLine.lastResponseAt,
      threadId: metaLine.threadId,
      messages,
    };
  }

  async deleteConversation(id: string): Promise<void> {
    await this.adapter.delete(this.filePath(id));
  }

  async listConversations(): Promise<ConversationMeta[]> {
    const files = await this.adapter.listFiles(SESSIONS_DIR);
    const metas: ConversationMeta[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const raw = await this.adapter.read(file);
        const firstLine = raw.split("\n")[0];
        if (!firstLine) continue;
        const meta = JSON.parse(firstLine);
        if (meta.type !== "meta") continue;

        // Count messages by counting remaining lines
        const lineCount = raw.split("\n").filter((l) => l.trim()).length - 1;
        const lastMsg = lineCount > 0 ? this.extractLastPreview(raw) : "";

        metas.push({
          id: meta.id,
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastResponseAt: meta.lastResponseAt,
          messageCount: lineCount,
          preview: lastMsg,
          threadId: meta.threadId,
        });
      } catch { /* skip malformed files */ }
    }

    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private extractLastPreview(raw: string): string {
    const lines = raw.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 1; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.type === "message" && parsed.message?.content) {
          return parsed.message.content.slice(0, 80);
        }
      } catch { /* skip */ }
    }
    return "";
  }
}
