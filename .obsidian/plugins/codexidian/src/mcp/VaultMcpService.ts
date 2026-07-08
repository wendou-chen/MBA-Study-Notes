import { App, normalizePath, TFile, TFolder } from "obsidian";

import type { McpToolCallRequest, McpToolCallResult } from "../types";
import { PathValidator } from "../security/PathValidator";

interface RelatedNoteOptions {
  limit: number;
  maxCharsPerNote: number;
  excludePaths?: Set<string>;
}

export interface VaultMcpSecuritySettings {
  blockedPatterns: string[];
  requireApprovalForWrite: boolean;
  maxNoteSizeKb: number;
}

export interface VaultMcpWriteApprovalRequest {
  path: string;
  mode: "overwrite" | "append";
  content: string;
  contentBytes: number;
}

const DEFAULT_MAX_READ_CHARS = 20_000;
const DEFAULT_MAX_CONTEXT_CHARS = 8_000;

export class VaultMcpService {
  constructor(
    private readonly app: App,
    private readonly getSecuritySettings: () => VaultMcpSecuritySettings = () => ({
      blockedPatterns: [],
      requireApprovalForWrite: false,
      maxNoteSizeKb: 500,
    }),
    private readonly requestWriteApproval?: (request: VaultMcpWriteApprovalRequest) => Promise<boolean>,
  ) {}

  async handleToolCall(request: McpToolCallRequest): Promise<McpToolCallResult> {
    const toolName = this.normalizeToolName(request.name);

    if (toolName === "list_notes") {
      return await this.handleListNotes(request.arguments);
    }
    if (toolName === "read_note") {
      return await this.handleReadNote(request.arguments);
    }
    if (toolName === "write_note") {
      return await this.handleWriteNote(request.arguments);
    }
    if (toolName === "search_notes") {
      return await this.handleSearchNotes(request.arguments);
    }

    return this.errorResult(
      `Unknown MCP tool '${request.name}'. Supported tools: list_notes, read_note, write_note, search_notes.`,
    );
  }

  async collectRelatedNotes(
    query: string,
    activeNotePath: string | null,
    options: RelatedNoteOptions,
  ): Promise<Array<{ path: string; content: string }>> {
    const pathValidator = this.getPathValidator();
    const limit = this.clampInt(options.limit, 0, 8, 3);
    if (limit <= 0) {
      return [];
    }

    const maxChars = this.clampInt(options.maxCharsPerNote, 500, 40_000, DEFAULT_MAX_CONTEXT_CHARS);
    const excluded = options.excludePaths ?? new Set<string>();
    const tokens = this.extractQueryTokens(query);

    const files = this.app.vault.getMarkdownFiles();
    const scored: Array<{ file: TFile; score: number }> = [];

    for (const file of files) {
      if (excluded.has(file.path)) continue;
      if (!pathValidator.validate(file.path, "read").allowed) continue;

      let score = 0;
      const lowerPath = file.path.toLowerCase();
      for (const token of tokens) {
        if (lowerPath.includes(token)) {
          score += 3;
        }
      }

      if (activeNotePath && file.path === activeNotePath) {
        score += 20;
      }

      if (score > 0) {
        scored.push({ file, score });
      }
    }

    if (
      scored.length === 0
      && activeNotePath
      && !excluded.has(activeNotePath)
      && pathValidator.validate(activeNotePath, "read").allowed
    ) {
      const activeFile = this.app.vault.getAbstractFileByPath(activeNotePath);
      if (activeFile instanceof TFile) {
        scored.push({ file: activeFile, score: 20 });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
    const selected = scored.slice(0, limit);

    const notes: Array<{ path: string; content: string }> = [];
    for (const entry of selected) {
      try {
        const raw = await this.app.vault.read(entry.file);
        notes.push({
          path: entry.file.path,
          content: this.truncateContent(raw, maxChars),
        });
      } catch {
        // Ignore single file read failures to keep context assembly resilient.
      }
    }

    return notes;
  }

  private async handleListNotes(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const folder = this.getOptionalString(args, ["folder", "path"]);
    const limit = this.clampInt(this.getOptionalNumber(args, ["limit"]), 1, 200, 50);
    const normalizedFolder = folder ? normalizePath(folder).replace(/\/+$/, "") : null;
    const pathValidator = this.getPathValidator();
    if (normalizedFolder) {
      const validation = pathValidator.validate(normalizedFolder, "read");
      if (!validation.allowed) {
        return this.blockedResult(validation.reason ?? "Path matches security blocklist.");
      }
    }

    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => (
        !normalizedFolder
        || file.path === normalizedFolder
        || file.path.startsWith(`${normalizedFolder}/`)
      ))
      .filter((file) => pathValidator.validate(file.path, "read").allowed)
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);

    const text = files.length > 0
      ? files.map((path) => `- ${path}`).join("\n")
      : "(no matching notes)";

    return this.successResult(
      `Listed ${files.length} note(s)${normalizedFolder ? ` under '${normalizedFolder}'` : ""}:\n${text}`,
    );
  }

  private async handleReadNote(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const path = this.getOptionalString(args, ["path", "notePath", "file"]);
    if (!path) {
      return this.errorResult("read_note requires argument 'path'.");
    }

    const normalized = normalizePath(path);
    const validation = this.getPathValidator().validate(normalized, "read");
    if (!validation.allowed) {
      return this.blockedResult(validation.reason ?? "Path matches security blocklist.");
    }

    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      return this.errorResult(`Note not found: ${normalized}`);
    }

    const maxChars = this.clampInt(this.getOptionalNumber(args, ["maxChars", "max_chars"]), 500, 100_000, DEFAULT_MAX_READ_CHARS);
    const content = await this.app.vault.read(file);
    const output = this.truncateContent(content, maxChars);

    return this.successResult(
      `<note path="${file.path}">\n${output}\n</note>`,
    );
  }

  private async handleWriteNote(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const path = this.getOptionalString(args, ["path", "notePath", "file"]);
    const content = this.getOptionalString(args, ["content", "text"]);
    const modeRaw = this.getOptionalString(args, ["mode"]);
    const mode = modeRaw === "append" ? "append" : "overwrite";

    if (!path) {
      return this.errorResult("write_note requires argument 'path'.");
    }
    if (content === null) {
      return this.errorResult("write_note requires argument 'content'.");
    }

    const normalized = normalizePath(path);
    const validation = this.getPathValidator().validate(normalized, "write");
    if (!validation.allowed) {
      return this.blockedResult(validation.reason ?? "Path matches security blocklist.");
    }

    const security = this.getSecuritySettings();
    const maxBytes = this.getMaxWriteBytes(security.maxNoteSizeKb);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);

    let nextContent = content;
    if (abstractFile instanceof TFile) {
      const existing = await this.app.vault.read(abstractFile);
      nextContent = mode === "append" ? `${existing}${content}` : content;
    }

    const nextBytes = this.getByteLength(nextContent);
    if (nextBytes > maxBytes) {
      return this.limitExceededResult(
        `write_note exceeds max note size (${security.maxNoteSizeKb} KB).`,
      );
    }

    if (security.requireApprovalForWrite) {
      if (!this.requestWriteApproval) {
        return this.blockedResult("Write requires approval but no approval handler is configured.");
      }

      let approved = false;
      try {
        approved = await this.requestWriteApproval({
          path: normalized,
          mode,
          content,
          contentBytes: this.getByteLength(content),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.blockedResult(`Write approval failed: ${message}`);
      }

      if (!approved) {
        return this.blockedResult("Write operation denied by user approval.");
      }
    }

    if (abstractFile instanceof TFile) {
      await this.app.vault.modify(abstractFile, nextContent);
      return this.successResult(`Updated note '${normalized}' (${mode}).`);
    }

    await this.ensureParentFolders(normalized);
    await this.app.vault.create(normalized, content);
    return this.successResult(`Created note '${normalized}'.`);
  }

  private async handleSearchNotes(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const query = this.getOptionalString(args, ["query", "q", "keyword"]);
    if (!query) {
      return this.errorResult("search_notes requires argument 'query'.");
    }

    const limit = this.clampInt(this.getOptionalNumber(args, ["limit"]), 1, 20, 5);
    const normalizedQuery = query.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const matches: Array<{ path: string; score: number; snippet: string }> = [];
    const pathValidator = this.getPathValidator();

    for (const file of files) {
      if (!pathValidator.validate(file.path, "read").allowed) {
        continue;
      }
      let score = 0;
      const lowerPath = file.path.toLowerCase();
      if (lowerPath.includes(normalizedQuery)) {
        score += 5;
      }

      let snippet = "";
      try {
        const content = await this.app.vault.read(file);
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(normalizedQuery);
        if (index >= 0) {
          score += 10;
          snippet = this.extractSnippet(content, index, query.length);
        }
      } catch {
        // Ignore individual file read issues.
      }

      if (score > 0) {
        matches.push({
          path: file.path,
          score,
          snippet,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const selected = matches.slice(0, limit);

    if (selected.length === 0) {
      return this.successResult(`No note matched query '${query}'.`);
    }

    const lines = selected.map((match, index) => {
      const snippetPart = match.snippet ? `\n   ${match.snippet}` : "";
      return `${index + 1}. ${match.path}${snippetPart}`;
    }).join("\n");

    return this.successResult(`Search results for '${query}':\n${lines}`);
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const parts = path.split("/");
    if (parts.length <= 1) return;

    let current = "";
    for (let index = 0; index < parts.length - 1; index++) {
      current = current ? `${current}/${parts[index]}` : parts[index];
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) {
        continue;
      }
      if (existing instanceof TFile) {
        throw new Error(`Cannot create folder '${current}' because a file with that path already exists.`);
      }
      try {
        await this.app.vault.createFolder(current);
      } catch {
        // Folder may already exist after a race; ignore.
      }
    }
  }

  private successResult(text: string): McpToolCallResult {
    return {
      success: true,
      contentItems: [{ type: "inputText", text }],
    };
  }

  private errorResult(text: string): McpToolCallResult {
    return {
      success: false,
      isError: true,
      contentItems: [{ type: "inputText", text }],
    };
  }

  private blockedResult(reason: string): McpToolCallResult {
    return {
      success: false,
      isError: true,
      error: "blocked",
      reason,
      contentItems: [{ type: "inputText", text: JSON.stringify({ error: "blocked", reason }) }],
    };
  }

  private limitExceededResult(reason: string): McpToolCallResult {
    return {
      success: false,
      isError: true,
      error: "limit_exceeded",
      reason,
      contentItems: [{ type: "inputText", text: reason }],
    };
  }

  private getPathValidator(): PathValidator {
    return new PathValidator(this.getSecuritySettings().blockedPatterns);
  }

  private getMaxWriteBytes(maxNoteSizeKb: number): number {
    const safeKb = Number.isFinite(maxNoteSizeKb) ? Math.max(1, Math.round(maxNoteSizeKb)) : 500;
    return safeKb * 1024;
  }

  private getByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  private normalizeToolName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/^\//, "")
      .replace(/[\s-]+/g, "_");
  }

  private getOptionalString(args: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string") {
        return value;
      }
    }
    return null;
  }

  private getOptionalNumber(args: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private clampInt(value: number | null, min: number, max: number, fallback: number): number {
    if (value === null) return fallback;
    const rounded = Math.round(value);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
  }

  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content;
    }
    return `${content.slice(0, maxChars)}\n\n...[truncated to ${maxChars} chars]`;
  }

  private extractSnippet(content: string, start: number, queryLength: number): string {
    const window = 90;
    const from = Math.max(0, start - window);
    const to = Math.min(content.length, start + queryLength + window);
    const snippet = content.slice(from, to).replace(/\s+/g, " ").trim();
    if (from > 0 && to < content.length) {
      return `...${snippet}...`;
    }
    if (from > 0) {
      return `...${snippet}`;
    }
    if (to < content.length) {
      return `${snippet}...`;
    }
    return snippet;
  }

  private extractQueryTokens(query: string): string[] {
    const stopwords = new Set([
      "the", "and", "for", "that", "this", "with", "from", "what", "when", "where",
      "how", "why", "about", "into", "over", "after", "before", "have", "has", "are",
      "was", "were", "you", "your", "note", "notes", "read", "write", "search",
    ]);

    return query
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fa5]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopwords.has(token))
      .slice(0, 8);
  }
}
