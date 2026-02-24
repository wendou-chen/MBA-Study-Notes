export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexidianSettings {
  codexCommand: string;
  workingDirectory: string;
  model: string;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  autoApproveRequests: boolean;
  persistThread: boolean;
  lastThreadId: string;
}

export const DEFAULT_SETTINGS: CodexidianSettings = {
  codexCommand: process.platform === "win32" ? "codex.cmd" : "codex",
  workingDirectory: "",
  model: "",
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
  autoApproveRequests: true,
  persistThread: true,
  lastThreadId: "",
};

export interface TurnResult {
  threadId: string;
  turnId: string;
  status: string;
  errorMessage?: string;
}

export interface TurnHandlers {
  onDelta?: (delta: string) => void;
  onToolDelta?: (delta: string) => void;
  onSystem?: (message: string) => void;
}
