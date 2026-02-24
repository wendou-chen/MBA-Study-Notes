export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";

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

export interface CodexidianSettings {
  codexCommand: string;
  workingDirectory: string;
  model: string;
  thinkingEffort: ThinkingEffort;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  autoApproveRequests: boolean;
  persistThread: boolean;
  lastThreadId: string;
  maxTabs: number;
  enableContextInjection: boolean;
  enableSelectionPolling: boolean;
}

export const DEFAULT_SETTINGS: CodexidianSettings = {
  codexCommand: process.platform === "win32" ? "codex.cmd" : "codex",
  workingDirectory: "",
  model: "",
  thinkingEffort: "medium",
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
  autoApproveRequests: true,
  persistThread: true,
  lastThreadId: "",
  maxTabs: 5,
  enableContextInjection: true,
  enableSelectionPolling: true,
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
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  threadId?: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
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
