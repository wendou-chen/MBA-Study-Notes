import type { SessionStorage } from "../storage/SessionStorage";
import type { MessageRenderer } from "../rendering/MessageRenderer";
import type { Conversation, ChatMessage, ConversationMeta } from "../types";
import { generateConversationId, generateMessageId } from "../types";

const SAVE_DEBOUNCE_MS = 500;

export class ConversationController {
  private activeConversation: Conversation | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: SessionStorage,
    private readonly renderer: MessageRenderer,
  ) {}

  getActive(): Conversation | null {
    return this.activeConversation;
  }

  getActiveThreadId(): string | undefined {
    return this.activeConversation?.threadId;
  }

  setThreadId(threadId: string): void {
    if (this.activeConversation) {
      this.activeConversation.threadId = threadId;
      this.scheduleSave();
    }
  }

  async createNew(title?: string): Promise<Conversation> {
    const now = Date.now();
    const conv: Conversation = {
      id: generateConversationId(),
      title: title ?? `Chat ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.activeConversation = conv;
    try {
      await this.storage.saveConversation(conv);
    } catch {
      // Keep the in-memory conversation usable even if persistence fails.
    }
    return conv;
  }

  async switchTo(id: string): Promise<Conversation | null> {
    await this.flushSave();
    const conv = await this.storage.loadConversation(id);
    if (conv) {
      this.activeConversation = conv;
    }
    return conv;
  }

  async loadActive(id: string): Promise<Conversation | null> {
    return this.switchTo(id);
  }

  addMessage(role: ChatMessage["role"], content: string): ChatMessage {
    if (!this.activeConversation) {
      throw new Error("No active conversation");
    }
    const msg: ChatMessage = {
      id: generateMessageId(),
      role,
      content,
      timestamp: Date.now(),
    };
    this.activeConversation.messages.push(msg);
    this.activeConversation.updatedAt = Date.now();
    if (role === "assistant") {
      this.activeConversation.lastResponseAt = Date.now();
    }
    this.scheduleSave();
    return msg;
  }

  async truncateAfter(messageId: string): Promise<ChatMessage | null> {
    if (!this.activeConversation) {
      throw new Error("No active conversation");
    }

    const index = this.activeConversation.messages.findIndex((msg) => msg.id === messageId);
    if (index < 0) {
      return null;
    }

    const target = this.activeConversation.messages[index];
    this.activeConversation.messages = this.activeConversation.messages.slice(0, index);
    this.activeConversation.updatedAt = Date.now();
    this.recomputeLastResponseAt();
    await this.flushSave();
    return { ...target };
  }

  getMessagesUpTo(messageId: string): ChatMessage[] {
    if (!this.activeConversation) {
      throw new Error("No active conversation");
    }

    const index = this.activeConversation.messages.findIndex((msg) => msg.id === messageId);
    if (index < 0) {
      return [];
    }

    return this.activeConversation.messages
      .slice(0, index + 1)
      .map((msg) => ({ ...msg }));
  }

  setMessages(messages: ChatMessage[]): void {
    if (!this.activeConversation) {
      throw new Error("No active conversation");
    }

    this.activeConversation.messages = messages.map((msg) => ({ ...msg }));
    this.activeConversation.updatedAt = Date.now();
    this.recomputeLastResponseAt();
    this.scheduleSave();
  }

  async deleteConversation(id: string): Promise<void> {
    await this.storage.deleteConversation(id);
    if (this.activeConversation?.id === id) {
      this.activeConversation = null;
    }
  }

  async renameConversation(id: string, newTitle: string): Promise<void> {
    if (this.activeConversation?.id === id) {
      this.activeConversation.title = newTitle;
      this.activeConversation.updatedAt = Date.now();
      this.scheduleSave();
    } else {
      const conv = await this.storage.loadConversation(id);
      if (conv) {
        conv.title = newTitle;
        conv.updatedAt = Date.now();
        await this.storage.saveConversation(conv);
      }
    }
  }

  async listConversations(): Promise<ConversationMeta[]> {
    return this.storage.listConversations();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.activeConversation) {
        void this.storage.saveConversation(this.activeConversation).catch(() => {
          // Ignore background persistence failures to avoid UI disruption.
        });
      }
    }, SAVE_DEBOUNCE_MS);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.activeConversation) {
      try {
        await this.storage.saveConversation(this.activeConversation);
      } catch {
        // Ignore flush failure; conversation remains available in memory.
      }
    }
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private recomputeLastResponseAt(): void {
    if (!this.activeConversation) return;
    const assistantMessages = this.activeConversation.messages.filter((msg) => msg.role === "assistant");
    if (assistantMessages.length === 0) {
      this.activeConversation.lastResponseAt = undefined;
      return;
    }
    const latest = assistantMessages.reduce((max, msg) => Math.max(max, msg.timestamp), 0);
    this.activeConversation.lastResponseAt = latest > 0 ? latest : undefined;
  }
}
