import type { Locale } from "./i18n";

export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";
export type ApprovalMode = "safe" | "prompt" | "yolo";
export type AllowRuleType = "command" | "file_write" | "tool";

export interface AllowRule {
  id: string;
  type: AllowRuleType;
  pattern: string;
  createdAt: number;
}

export const AVAILABLE_MODELS = [
  { value: "", label: "Default (Codex)" },
  { value: "codex-5.3", label: "Codex 5.3" },
  { value: "gpt-5.2", label: "GPT 5.2" },
] as const;

export const EFFORT_OPTIONS: { value: ThinkingEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

export const APPROVAL_MODES: { value: ApprovalMode; label: string; description: string }[] = [
  { value: "safe", label: "Safe", description: "prompt-free decline" },
  { value: "prompt", label: "Prompt", description: "ask in transcript" },
  { value: "yolo", label: "Yolo", description: "auto-approve" },
];

export function isApprovalMode(value: string): value is ApprovalMode {
  return APPROVAL_MODES.some((mode) => mode.value === value);
}

export interface CodexidianSettings {
  locale: Locale;
  codexCommand: string;
  workingDirectory: string;
  model: string;
  thinkingEffort: ThinkingEffort;
  contextWindowSize: 128 | 400;
  approvalMode: ApprovalMode;
  allowRules: AllowRule[];
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  autoApproveRequests: boolean;
  persistThread: boolean;
  lastThreadId: string;
  maxTabs: number;
  enableContextInjection: boolean;
  enableSelectionPolling: boolean;
  enableReviewPane: boolean;
  enableMcp: boolean;
  mcpEndpoint: string;
  mcpApiKey: string;
  mcpContextNoteLimit: number;
  // Security
  securityBlockedPaths: string[];
  securityRequireApprovalForWrite: boolean;
  securityMaxNoteSize: number;
}

export const DEFAULT_SETTINGS: CodexidianSettings = {
  locale: "zh",
  codexCommand: process.platform === "win32" ? "codex.cmd" : "codex",
  workingDirectory: "",
  model: "",
  thinkingEffort: "medium",
  contextWindowSize: 128,
  approvalMode: "prompt",
  allowRules: [],
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
  autoApproveRequests: true,
  persistThread: true,
  lastThreadId: "",
  maxTabs: 5,
  enableContextInjection: true,
  enableSelectionPolling: true,
  enableReviewPane: false,
  enableMcp: false,
  mcpEndpoint: "http://127.0.0.1:27124",
  mcpApiKey: "",
  mcpContextNoteLimit: 3,
  securityBlockedPaths: [
    ".obsidian/",
    ".claude/",
    ".codex/",
    ".agent/",
    ".env",
    "*.secret",
  ],
  securityRequireApprovalForWrite: true,
  securityMaxNoteSize: 500,
};

export interface TurnResult {
  threadId: string;
  turnId: string;
  status: string;
  errorMessage?: string;
}

export interface ToolStartInfo {
  turnId: string;
  itemId: string;
  type: string;
  name?: string;
  command?: string;
  filePath?: string;
}

export interface ToolCompleteInfo {
  turnId: string;
  itemId: string;
  type: string;
  status: string;
  name?: string;
  command?: string;
  filePath?: string;
}

export interface TurnHandlers {
  onDelta?: (delta: string) => void;
  onToolDelta?: (delta: string) => void;
  onSystem?: (message: string) => void;
  onToolStart?: (info: ToolStartInfo) => void;
  onToolComplete?: (info: ToolCompleteInfo) => void;
  onThinkingDelta?: (delta: string) => void;
}

export interface StatusEntry {
  id: string;
  type: "tool_call" | "thinking" | "subagent" | "info";
  label: string;
  detail?: string;
  status: "running" | "completed" | "failed";
  timestamp: number;
  duration?: number;
}

export type TurnStatus = "idle" | "thinking" | "streaming" | "tool_calling" | "waiting_approval";

export interface ReviewComment {
  id: string;
  scope: string;
  text: string;
  createdAt: number;
}

export interface DiffEntry {
  filePath: string;
  status: "added" | "modified" | "deleted";
  summary?: string;
}

export interface PlanStep {
  id: string;
  index: number;
  description: string;
  status: "pending" | "approved" | "executing" | "completed" | "failed" | "skipped";
}

export interface PlanUpdate {
  planId: string;
  title: string;
  steps: PlanStep[];
  status: "proposed" | "approved" | "in_progress" | "completed";
}

export interface McpToolCallRequest {
  requestId: string | number;
  name: string;
  arguments: Record<string, unknown>;
  rawParams: unknown;
}

export interface McpToolCallResult {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
  isError?: boolean;
  error?: string;
  reason?: string;
}

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon?: string;
  execute: () => void | Promise<void>;
}

export interface ApprovalRequest {
  requestId: string | number;
  type: "commandExecution" | "fileChange" | "execCommand" | "applyPatch";
  command?: string;
  filePath?: string;
  cwd?: string;
  params?: any;
}

export type ApprovalDecision = "accept" | "decline";

export interface UserInputRequest {
  requestId: string | number;
  questions: Array<{ id: string; text?: string; options?: Array<{ label: string }> }>;
}

export interface UserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

// --- Conversation persistence ---

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  messageCount: number;
  preview: string;
  threadId?: string;
  archived?: boolean;
  pinned?: boolean;
  tags?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  threadId?: string;
  archived?: boolean;
  pinned?: boolean;
  tags?: string[];
  messages: ChatMessage[];
}

export type ConversationListFilter = "all" | "active" | "archived" | "pinned";

export interface ChatMessageImage {
  name: string;
  dataUrl: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: ChatMessageImage[];
}

// --- Tabs ---

export interface TabState {
  tabId: string;
  conversationId: string | null;
}

export interface TabManagerState {
  openTabs: TabState[];
  activeTabId: string | null;
}

// --- Editor context ---

export interface EditorContext {
  notePath: string;
  mode: "selection";
  selectedText: string;
  lineCount: number;
  startLine: number;
}

// --- ID generators ---

export function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
