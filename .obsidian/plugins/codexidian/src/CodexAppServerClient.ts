import { ChildProcess, spawn, spawnSync } from "child_process";

import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexidianSettings,
  McpToolCallRequest,
  McpToolCallResult,
  ToolCompleteInfo,
  ToolStartInfo,
  UserInputRequest,
  UserInputResponse,
  TurnHandlers,
  TurnResult,
} from "./types";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingTurn {
  handlers: TurnHandlers;
  resolve: (result: TurnResult) => void;
  reject: (error: Error) => void;
  startedAt: number;
}

interface CommandProbeResult {
  ok: boolean;
  detail: string;
}

type TurnImageOption = {
  dataUrl?: string;
  path?: string;
};

export class CodexAppServerClient {
  private process: ChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private requestCounter = 1;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingTurns = new Map<string, PendingTurn>();
  private preTurnDeltas = new Map<string, string[]>();
  private preTurnToolDeltas = new Map<string, string[]>();
  private preTurnThinkingDeltas = new Map<string, string[]>();
  private preTurnToolStarts = new Map<string, ToolStartInfo[]>();
  private preTurnToolCompletes = new Map<string, ToolCompleteInfo[]>();
  private preTurnResult = new Map<string, TurnResult>();
  private turnHasMessageDelta = new Set<string>();
  private turnHasThinkingDelta = new Set<string>();
  private turnActiveToolItemId = new Map<string, string>();
  private startPromise: Promise<void> | null = null;
  private disposed = false;
  private intentionalShutdown = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectAttempts = 3;
  private activeCommand: string | null = null;

  private currentThreadId: string | null = null;
  private currentTurnId: string | null = null;

  constructor(
    private readonly getSettings: () => CodexidianSettings,
    private readonly getVaultPath: () => string,
    private readonly onThreadIdChanged: (threadId: string) => void,
    private readonly onSystemMessage: (message: string) => void,
    private readonly onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalDecision>,
    private readonly onUserInputRequest?: (request: UserInputRequest) => Promise<UserInputResponse>,
    private readonly onMcpToolCall?: (request: McpToolCallRequest) => Promise<McpToolCallResult>,
  ) {}

  getThreadId(): string | null {
    return this.currentThreadId;
  }

  isRunning(): boolean {
    return Boolean(this.process && !this.process.killed);
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  setThreadId(threadId: string | null): void {
    this.currentThreadId = threadId;
  }

  async cancelTurn(turnId: string): Promise<boolean> {
    const normalizedTurnId = turnId.trim();
    if (!normalizedTurnId) {
      return false;
    }

    let cancelled = false;

    if (this.process && !this.process.killed) {
      try {
        await this.request("turn/cancel", { turnId: normalizedTurnId });
        cancelled = true;
      } catch {
        // Keep local cancellation fallback even if protocol support differs.
      }
    }

    const pending = this.pendingTurns.get(normalizedTurnId);
    if (pending) {
      this.pendingTurns.delete(normalizedTurnId);
      pending.resolve({
        threadId: this.currentThreadId ?? "",
        turnId: normalizedTurnId,
        status: "cancelled",
        errorMessage: "Cancelled by user",
      });
      cancelled = true;
    }

    this.preTurnDeltas.delete(normalizedTurnId);
    this.preTurnToolDeltas.delete(normalizedTurnId);
    this.preTurnThinkingDeltas.delete(normalizedTurnId);
    this.preTurnToolStarts.delete(normalizedTurnId);
    this.preTurnToolCompletes.delete(normalizedTurnId);
    this.preTurnResult.delete(normalizedTurnId);
    this.clearTurnTransientState(normalizedTurnId);
    this.clearCurrentTurnId(normalizedTurnId);
    return cancelled;
  }

  async restart(): Promise<void> {
    await this.dispose();
    this.disposed = false;
    this.intentionalShutdown = false;
    this.reconnectAttempts = 0;
    await this.start();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.intentionalShutdown = true;
    this.clearReconnectTimer();

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Codex app-server stopped."));
      this.pendingRequests.delete(id);
    }

    for (const [turnId, turn] of this.pendingTurns) {
      turn.reject(new Error(`Turn ${turnId} interrupted: app-server stopped.`));
      this.pendingTurns.delete(turnId);
      this.clearTurnTransientState(turnId);
      this.clearCurrentTurnId(turnId);
    }

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.startPromise = null;
    this.currentTurnId = null;
    this.preTurnDeltas.clear();
    this.preTurnToolDeltas.clear();
    this.preTurnThinkingDeltas.clear();
    this.preTurnToolStarts.clear();
    this.preTurnToolCompletes.clear();
    this.preTurnResult.clear();
    this.turnHasMessageDelta.clear();
    this.turnHasThinkingDelta.clear();
    this.turnActiveToolItemId.clear();
  }

  async newThread(): Promise<string> {
    await this.start();
    const threadId = await this.startThread();
    return threadId;
  }

  async sendTurn(
    prompt: string,
    handlers: TurnHandlers = {},
    options?: { model?: string; effort?: string; images?: TurnImageOption[] },
  ): Promise<TurnResult> {
    this.debugLog("sendTurn:start", {
      promptLength: prompt.length,
      model: options?.model ?? null,
      effort: options?.effort ?? null,
      imageCount: options?.images?.length ?? 0,
    });
    await this.start();
    let threadId = await this.ensureThread();
    let turnResponse: any;
    try {
      turnResponse = await this.request("turn/start", this.buildTurnStartParams(threadId, prompt, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isThreadNotFoundError(message)) {
        throw error;
      }

      this.debugLog("turn/start thread not found, retrying with thread/start", {
        threadId,
        message,
      });
      this.invalidateThreadState(threadId);
      threadId = await this.startThread();
      turnResponse = await this.request("turn/start", this.buildTurnStartParams(threadId, prompt, options));
    }

    const turnId = turnResponse?.turn?.id as string | undefined;
    if (!turnId) {
      throw new Error("turn/start did not return turn id.");
    }
    this.currentTurnId = turnId;

    return await new Promise<TurnResult>((resolve, reject) => {
      const turnTimeout = setTimeout(() => {
        if (!this.pendingTurns.has(turnId)) {
          return;
        }
        this.pendingTurns.delete(turnId);
        this.clearTurnTransientState(turnId);
        this.clearCurrentTurnId(turnId);
        reject(new Error("Turn timed out after 15 minutes."));
      }, 15 * 60 * 1000);

      this.pendingTurns.set(turnId, {
        handlers,
        resolve: (result) => {
          clearTimeout(turnTimeout);
          this.clearTurnTransientState(turnId);
          this.clearCurrentTurnId(turnId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(turnTimeout);
          this.clearTurnTransientState(turnId);
          this.clearCurrentTurnId(turnId);
          reject(error);
        },
        startedAt: Date.now(),
      });

      const preDeltas = this.preTurnDeltas.get(turnId);
      if (preDeltas && preDeltas.length > 0) {
        for (const delta of preDeltas) {
          this.safeInvoke(() => handlers.onDelta?.(delta), `onDelta(pre):${turnId}`);
        }
        this.preTurnDeltas.delete(turnId);
      }

      const preToolDeltas = this.preTurnToolDeltas.get(turnId);
      if (preToolDeltas && preToolDeltas.length > 0) {
        for (const delta of preToolDeltas) {
          this.safeInvoke(() => handlers.onToolDelta?.(delta), `onToolDelta(pre):${turnId}`);
        }
        this.preTurnToolDeltas.delete(turnId);
      }

      const preThinkingDeltas = this.preTurnThinkingDeltas.get(turnId);
      if (preThinkingDeltas && preThinkingDeltas.length > 0) {
        for (const delta of preThinkingDeltas) {
          this.safeInvoke(() => handlers.onThinkingDelta?.(delta), `onThinkingDelta(pre):${turnId}`);
        }
        this.preTurnThinkingDeltas.delete(turnId);
      }

      const preToolStarts = this.preTurnToolStarts.get(turnId);
      if (preToolStarts && preToolStarts.length > 0) {
        for (const info of preToolStarts) {
          this.safeInvoke(() => handlers.onToolStart?.(info), `onToolStart(pre):${turnId}`);
        }
        this.preTurnToolStarts.delete(turnId);
      }

      const preToolCompletes = this.preTurnToolCompletes.get(turnId);
      if (preToolCompletes && preToolCompletes.length > 0) {
        for (const info of preToolCompletes) {
          this.safeInvoke(() => handlers.onToolComplete?.(info), `onToolComplete(pre):${turnId}`);
        }
        this.preTurnToolCompletes.delete(turnId);
      }

      const result = this.preTurnResult.get(turnId);
      if (result) {
        this.preTurnResult.delete(turnId);
        this.pendingTurns.delete(turnId);
        this.clearTurnTransientState(turnId);
        this.clearCurrentTurnId(turnId);
        resolve(result);
      }
    });
  }

  private async start(): Promise<void> {
    this.intentionalShutdown = false;
    this.disposed = false;
    this.clearReconnectTimer();

    if (this.process && !this.process.killed) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();

    try {
      await this.startPromise;
      this.reconnectAttempts = 0;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    const settings = this.getSettings();
    const cwd = this.resolveCwd(settings);
    const env = this.buildSpawnEnv();
    const commandCandidates = this.buildCommandCandidates(settings.codexCommand);
    if (commandCandidates.length === 0) {
      throw new Error("Codex command is empty. Please configure it in settings.");
    }
    this.debugLog("start:env", {
      configuredCommand: settings.codexCommand,
      reconnectAttempts: this.reconnectAttempts,
      platform: process.platform,
      cwd,
      pathPreview: (env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").slice(0, 10),
      candidates: commandCandidates,
    });
    const selected = this.selectStartCommand(commandCandidates, env, cwd);
    const command = selected.command;
    this.activeCommand = command;
    this.debugLog("app-server start command", {
      command,
      probe: selected.probe.detail,
      reconnectAttempts: this.reconnectAttempts,
      cwd,
    });

    let child: ChildProcess;
    try {
      child = spawn(command, ["app-server", "--listen", "stdio://"], {
        cwd,
        env,
        shell: process.platform === "win32",
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.debugError("spawn:throw", error, { command, cwd });
      this.onSystemMessage(`Failed to spawn Codex app-server: ${message}`);
      this.scheduleReconnect();
      throw error;
    }

    this.process = child;

    child.stdout?.on("data", (chunk) => {
      this.consumeStdout(chunk.toString());
    });

    child.stderr?.on("data", (chunk) => {
      this.consumeStderr(chunk.toString());
    });

    child.on("error", (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.debugError("spawn:error-event", error, { command, cwd });
      this.handleProcessTermination(child, `Codex app-server error (${command}): ${reason}`);
    });

    child.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `${code ?? "unknown"}`;
      this.debugLog("spawn:exit-event", { command, code, signal: signal ?? null });
      this.handleProcessTermination(child, `Codex app-server exited (${reason}) [${command}].`);
    });

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codexidian",
          title: "Codexidian",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: null,
        },
      });

      this.notify("initialized");
      this.reconnectAttempts = 0;
    } catch (error) {
      if (this.process === child && !child.killed) {
        try {
          child.kill();
        } catch {
          // Ignore shutdown race during failed initialization.
        }
      }
      throw error;
    }
  }

  private handleProcessTermination(child: ChildProcess, message: string): void {
    if (this.process !== child) {
      return;
    }

    this.rejectAllPending(message);
    this.process = null;
    this.currentTurnId = null;
    this.activeCommand = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.preTurnDeltas.clear();
    this.preTurnToolDeltas.clear();
    this.preTurnThinkingDeltas.clear();
    this.preTurnToolStarts.clear();
    this.preTurnToolCompletes.clear();
    this.preTurnResult.clear();
    this.turnHasMessageDelta.clear();
    this.turnHasThinkingDelta.clear();
    this.turnActiveToolItemId.clear();

    if (this.disposed || this.intentionalShutdown) {
      return;
    }

    this.onSystemMessage(message);
    this.scheduleReconnect();
  }

  private rejectAllPending(message: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pendingRequests.delete(id);
    }

    for (const [turnId, turn] of this.pendingTurns) {
      turn.reject(new Error(message));
      this.pendingTurns.delete(turnId);
      this.clearTurnTransientState(turnId);
      this.clearCurrentTurnId(turnId);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalShutdown) {
      return;
    }
    if (this.reconnectTimer !== null) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onSystemMessage("Codex app-server reconnect attempts exhausted. Use Reconnect/Restart to try again.");
      return;
    }

    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    const delayMs = Math.min(8_000, 1_000 * (2 ** (attempt - 1)));
    this.onSystemMessage(
      `Reconnecting to Codex app-server in ${Math.ceil(delayMs / 1000)}s (${attempt}/${this.maxReconnectAttempts})...`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.intentionalShutdown) {
        return;
      }

      void this.start()
        .then(() => {
          this.onSystemMessage("Codex app-server reconnected.");
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.onSystemMessage(`Reconnect attempt ${attempt} failed: ${reason}`);
          if (!this.isRunning()) {
            this.scheduleReconnect();
          }
        });
    }, delayMs);
  }

  private async ensureThread(): Promise<string> {
    if (this.currentThreadId) {
      return this.currentThreadId;
    }

    const settings = this.getSettings();
    const savedThreadId = settings.persistThread ? settings.lastThreadId?.trim() : "";

    if (savedThreadId) {
      try {
        const resumed = await this.request("thread/resume", {
          threadId: savedThreadId,
          model: settings.model.trim() || null,
          modelProvider: null,
          cwd: this.resolveCwd(settings),
          approvalPolicy: settings.approvalPolicy,
          sandbox: settings.sandboxMode,
          config: null,
          baseInstructions: null,
          developerInstructions: null,
          personality: null,
        });

        const resumedId = resumed?.thread?.id as string | undefined;
        if (resumedId) {
          this.updateThreadId(resumedId);
          return resumedId;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.debugLog("thread/resume failed, falling back to thread/start", {
          threadId: savedThreadId,
          message: msg,
        });
        this.onSystemMessage(`Failed to resume thread, starting new one. (${msg})`);
        this.invalidateThreadState(savedThreadId);
      }
    }

    return await this.startThread();
  }

  private async startThread(): Promise<string> {
    const settings = this.getSettings();
    const response = await this.request("thread/start", {
      model: settings.model.trim() || null,
      modelProvider: null,
      cwd: this.resolveCwd(settings),
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandboxMode,
      config: null,
      baseInstructions: null,
      developerInstructions: null,
      personality: null,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });

    const threadId = response?.thread?.id as string | undefined;
    if (!threadId) {
      throw new Error("thread/start did not return thread id.");
    }

    this.updateThreadId(threadId);
    this.debugLog("new thread created", { threadId });
    return threadId;
  }

  private resolveCwd(settings: CodexidianSettings): string {
    const explicit = settings.workingDirectory.trim();
    if (explicit) {
      return explicit;
    }
    return this.getVaultPath();
  }

  private buildTurnStartParams(
    threadId: string,
    prompt: string,
    options?: { model?: string; effort?: string; images?: TurnImageOption[] },
  ): Record<string, unknown> {
    const imageInputs: Array<{ type: "image"; url: string } | { type: "localImage"; path: string }> = [];
    let droppedImages = 0;

    for (const image of options?.images ?? []) {
      const localPath = typeof image?.path === "string" ? image.path.trim() : "";
      if (localPath.length > 0) {
        imageInputs.push({ type: "localImage", path: localPath });
        continue;
      }

      const rawUrl = typeof image?.dataUrl === "string" ? image.dataUrl.trim() : "";
      const normalizedUrl = this.normalizeImageUrl(rawUrl);
      if (!normalizedUrl) {
        droppedImages += 1;
        continue;
      }
      imageInputs.push({ type: "image", url: normalizedUrl });
    }

    if (imageInputs.length > 0 || droppedImages > 0) {
      const firstImage = imageInputs[0];
      this.debugLog("image payload", {
        count: imageInputs.length,
        droppedImages,
        firstImageType: firstImage?.type ?? null,
        firstImageUrlPrefix: firstImage && firstImage.type === "image"
          ? firstImage.url.slice(0, 50)
          : null,
        firstImageUrlLength: firstImage && firstImage.type === "image"
          ? firstImage.url.length
          : null,
        firstImagePath: firstImage && firstImage.type === "localImage"
          ? firstImage.path
          : null,
      });
    }

    return {
      threadId,
      input: [
        ...imageInputs,
        { type: "text", text: prompt, text_elements: [] },
      ],
      cwd: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: options?.model?.trim() || null,
      effort: options?.effort || null,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    };
  }

  private normalizeImageUrl(url: string): string | null {
    const normalized = url.trim();
    if (!normalized) {
      return null;
    }
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
      return normalized;
    }
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    if (/^file:\/\//i.test(normalized)) {
      return normalized;
    }
    // Fallback for raw base64 strings without a data URL prefix.
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length >= 64) {
      return `data:image/png;base64,${normalized}`;
    }
    return null;
  }

  private isThreadNotFoundError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return normalized.includes("thread not found");
  }

  private invalidateThreadState(threadId: string): void {
    if (this.currentThreadId && this.currentThreadId === threadId) {
      this.currentThreadId = null;
    }

    const settings = this.getSettings();
    if (settings.lastThreadId && settings.lastThreadId.trim() === threadId) {
      settings.lastThreadId = "";
      try {
        this.onThreadIdChanged("");
      } catch {
        // Best-effort persistence cleanup.
      }
    }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.onSystemMessage(`[app-server/stdout] ${trimmed}`);
        continue;
      }

      this.routeIncomingMessage(parsed);
    }
  }

  private consumeStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.includes("failed to install system skills") || trimmed.includes("failed to record rollout")) {
        continue;
      }
      if (trimmed.startsWith("WARNING: proceeding, even though we could not update PATH")) {
        continue;
      }
      this.onSystemMessage(`[app-server/stderr] ${trimmed}`);
    }
  }

  private routeIncomingMessage(message: any): void {
    if (message && Object.prototype.hasOwnProperty.call(message, "id") &&
      (Object.prototype.hasOwnProperty.call(message, "result") || Object.prototype.hasOwnProperty.call(message, "error"))) {
      this.resolvePendingRequest(message);
      return;
    }

    if (message && Object.prototype.hasOwnProperty.call(message, "id") && typeof message.method === "string") {
      void this.handleServerRequest(message);
      return;
    }

    if (message && typeof message.method === "string") {
      this.handleNotification(message);
    }
  }

  private resolvePendingRequest(message: any): void {
    const requestId = String(message.id);
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (Object.prototype.hasOwnProperty.call(message, "error") && message.error) {
      const err = message.error?.message || JSON.stringify(message.error);
      pending.reject(new Error(err));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(message: any): Promise<void> {
    const requestId = message.id;
    const method = message.method;
    const settings = this.getSettings();

    try {
      let result: any;

      if (this.isApprovalMethod(method)) {
        const approvalType = this.mapApprovalType(method);
        const approvalRequest: ApprovalRequest = {
          requestId,
          type: approvalType,
          command: this.extractApprovalCommand(message.params),
          filePath: this.extractApprovalFilePath(message.params),
          cwd: this.extractApprovalCwd(message.params),
          params: message.params,
        };
        const decision = await this.resolveApprovalDecision(approvalRequest);

        if (method === "execCommandApproval" || method === "applyPatchApproval") {
          result = { decision: decision === "accept" ? "approved" : "denied" };
        } else {
          result = { decision };
        }
      } else if (method === "item/tool/requestUserInput") {
        const userInputRequest = this.buildUserInputRequest(requestId, message.params);
        let response: UserInputResponse | null = null;

        if (this.onUserInputRequest) {
          try {
            response = await this.withTimeout(this.onUserInputRequest(userInputRequest), 60_000);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.onSystemMessage(`[input] Request timed out, using fallback response. (${reason})`);
          }
        }

        result = response ?? this.buildDefaultUserInputResponse(userInputRequest);
      } else if (method === "item/tool/call") {
        if (!settings.enableMcp) {
          result = this.buildToolCallErrorResult("MCP is disabled in Codexidian settings.");
        } else if (!this.onMcpToolCall) {
          result = this.buildToolCallErrorResult("No MCP tool handler is configured.");
        } else {
          const toolRequest = this.buildMcpToolCallRequest(requestId, message.params);
          if (!toolRequest.name) {
            result = this.buildToolCallErrorResult("Tool call is missing tool name.");
          } else {
            try {
              result = await this.withTimeout(this.onMcpToolCall(toolRequest), 120_000);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              result = this.buildToolCallErrorResult(`MCP tool call failed (${toolRequest.name}): ${reason}`);
            }
          }
        }
      } else {
        this.writeJson({
          id: requestId,
          error: {
            code: -32601,
            message: `Unsupported server request: ${method}`,
          },
        });
        return;
      }

      this.writeJson({ id: requestId, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.writeJson({
        id: requestId,
        error: {
          code: -32603,
          message: msg,
        },
      });
    }
  }

  private isApprovalMethod(method: string): boolean {
    return (
      method === "item/commandExecution/requestApproval"
      || method === "item/fileChange/requestApproval"
      || method === "execCommandApproval"
      || method === "applyPatchApproval"
    );
  }

  private mapApprovalType(method: string): ApprovalRequest["type"] {
    if (method === "item/commandExecution/requestApproval") return "commandExecution";
    if (method === "item/fileChange/requestApproval") return "fileChange";
    if (method === "execCommandApproval") return "execCommand";
    return "applyPatch";
  }

  private async resolveApprovalDecision(request: ApprovalRequest): Promise<ApprovalDecision> {
    const requestSummary = this.buildApprovalSummary(request);
    const { approvalMode } = this.getSettings();

    if (approvalMode === "yolo") {
      this.onSystemMessage(`[approval] Auto-approved ${requestSummary}`);
      return "accept";
    }

    if (approvalMode === "safe") {
      this.onSystemMessage(`[approval] Auto-denied ${requestSummary}`);
      return "decline";
    }

    if (this.onApprovalRequest) {
      try {
        return await this.withTimeout(this.onApprovalRequest(request), 60_000);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.onSystemMessage(`[approval] Timed out. Denied ${requestSummary}. (${reason})`);
        return "decline";
      }
    }

    this.onSystemMessage(`[approval] No approval UI available. Denied ${requestSummary}.`);
    return "decline";
  }

  private buildApprovalSummary(request: ApprovalRequest): string {
    if (request.command) {
      return `${request.type} (${request.command.slice(0, 80)})`;
    }
    if (request.filePath) {
      return `${request.type} (${request.filePath})`;
    }
    return request.type;
  }

  private extractApprovalCommand(params: any): string | undefined {
    const direct = params?.command
      ?? params?.cmd
      ?? params?.input?.command
      ?? params?.request?.command
      ?? params?.request?.cmd;

    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }

    if (Array.isArray(params?.command) && params.command.every((part: unknown) => typeof part === "string")) {
      return params.command.join(" ").trim() || undefined;
    }

    return undefined;
  }

  private extractApprovalFilePath(params: any): string | undefined {
    const direct = params?.filePath
      ?? params?.path
      ?? params?.targetPath
      ?? params?.request?.filePath
      ?? params?.request?.path
      ?? params?.file?.path;

    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }

    const changePath = Array.isArray(params?.changes)
      ? params.changes.find((entry: any) => typeof entry?.path === "string")?.path
      : undefined;
    if (typeof changePath === "string" && changePath.trim().length > 0) {
      return changePath.trim();
    }

    return undefined;
  }

  private extractApprovalCwd(params: any): string | undefined {
    const cwd = params?.cwd ?? params?.workingDirectory ?? params?.request?.cwd;
    if (typeof cwd === "string" && cwd.trim().length > 0) {
      return cwd.trim();
    }
    return undefined;
  }

  private buildUserInputRequest(requestId: string | number, params: any): UserInputRequest {
    const rawQuestions = Array.isArray(params?.questions) ? params.questions : [];
    const questions = rawQuestions
      .map((q: any) => {
        const id = typeof q?.id === "string" ? q.id : "";
        if (!id) return null;
        const text = typeof q?.question === "string"
          ? q.question
          : (typeof q?.text === "string" ? q.text : undefined);
        const options = Array.isArray(q?.options)
          ? q.options
            .map((option: any) => {
              const label = typeof option?.label === "string" ? option.label : "";
              if (!label) return null;
              return { label };
            })
            .filter((option: { label: string } | null): option is { label: string } => Boolean(option))
          : undefined;
        return { id, text, options };
      })
      .filter((question: { id: string; text?: string; options?: Array<{ label: string }> } | null): question is {
        id: string;
        text?: string;
        options?: Array<{ label: string }>;
      } => Boolean(question));

    return { requestId, questions };
  }

  private buildDefaultUserInputResponse(request: UserInputRequest): UserInputResponse {
    const answers: Record<string, { answers: string[] }> = {};
    for (const question of request.questions) {
      const firstOption = question.options && question.options.length > 0 ? question.options[0].label : "";
      answers[question.id] = { answers: [firstOption] };
    }
    return { answers };
  }

  private buildMcpToolCallRequest(requestId: string | number, params: unknown): McpToolCallRequest {
    const normalizedParams = params && typeof params === "object"
      ? params as Record<string, unknown>
      : {};

    return {
      requestId,
      name: this.extractToolCallName(normalizedParams),
      arguments: this.extractToolCallArguments(normalizedParams),
      rawParams: params,
    };
  }

  private extractToolCallName(params: Record<string, unknown>): string {
    const candidates: unknown[] = [
      params.name,
      params.toolName,
      (params.tool as Record<string, unknown> | undefined)?.name,
      (params.call as Record<string, unknown> | undefined)?.name,
      (params.request as Record<string, unknown> | undefined)?.name,
      (params.toolCall as Record<string, unknown> | undefined)?.name,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return "";
  }

  private extractToolCallArguments(params: Record<string, unknown>): Record<string, unknown> {
    const candidates: unknown[] = [
      params.arguments,
      params.args,
      params.input,
      (params.call as Record<string, unknown> | undefined)?.arguments,
      (params.request as Record<string, unknown> | undefined)?.arguments,
      (params.tool as Record<string, unknown> | undefined)?.input,
    ];

    for (const candidate of candidates) {
      const parsed = this.parseToolArguments(candidate);
      if (parsed) {
        return parsed;
      }
    }
    return {};
  }

  private parseToolArguments(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return { input: trimmed };
    }
  }

  private buildToolCallErrorResult(message: string): McpToolCallResult {
    return {
      success: false,
      isError: true,
      contentItems: [{ type: "inputText", text: message }],
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private handleNotification(message: any): void {
    const method = message.method as string;
    const params = message.params ?? {};

    if (method === "thread/started") {
      const threadId = params?.thread?.id;
      if (typeof threadId === "string" && threadId) {
        this.updateThreadId(threadId);
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const turnId = params?.turnId;
      const delta = params?.delta;
      if (typeof turnId === "string" && typeof delta === "string" && delta.length > 0) {
        this.turnHasMessageDelta.add(turnId);
        this.emitTurnDelta(turnId, delta);
      }
      return;
    }

    if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
      const turnId = params?.turnId;
      const delta = params?.delta;
      if (typeof turnId === "string" && typeof delta === "string" && delta.length > 0) {
        const itemId = this.extractItemId(params?.item ?? params, turnId);
        if (itemId) {
          this.turnActiveToolItemId.set(turnId, itemId);
        }
        this.emitToolDelta(turnId, delta);
      }
      return;
    }

    if (method.startsWith("item/") && method.endsWith("/delta")) {
      const turnId = params?.turnId;
      const delta = this.extractTextDelta(params);
      if (typeof turnId === "string" && typeof delta === "string" && delta.length > 0 && this.isThinkingMethod(method)) {
        this.emitThinkingDelta(turnId, delta);
      }
      return;
    }

    if (method === "item/started") {
      const turnId = params?.turnId;
      const item = params?.item;
      const itemType = this.normalizeItemType(item?.type ?? params?.type);
      const itemId = this.extractItemId(item, turnId);
      if (typeof turnId === "string" && itemId) {
        if (this.isThinkingType(itemType)) {
          const initialThinking = this.extractTextDelta(item);
          if (initialThinking) {
            this.emitThinkingDelta(turnId, initialThinking);
          }
          return;
        }

        if (itemType !== "agentmessage") {
          const info: ToolStartInfo = {
            turnId,
            itemId,
            type: itemType || "tool",
            name: this.extractToolName(item),
            command: this.extractCommand(item),
            filePath: this.extractFilePath(item),
          };
          this.turnActiveToolItemId.set(turnId, itemId);
          this.emitToolStart(turnId, info);
        }
      }
      return;
    }

    if (method === "item/completed") {
      const turnId = params?.turnId;
      const item = params?.item;
      const itemType = this.normalizeItemType(item?.type ?? params?.type);
      if (typeof turnId === "string") {
        if (itemType === "agentmessage" && typeof item?.text === "string") {
          if (!this.turnHasMessageDelta.has(turnId) && item.text.length > 0) {
            this.emitTurnDelta(turnId, item.text);
          }
          return;
        }

        if (this.isThinkingType(itemType)) {
          const completedThinking = this.extractTextDelta(item);
          if (completedThinking && !this.turnHasThinkingDelta.has(turnId)) {
            this.emitThinkingDelta(turnId, completedThinking);
          }
          return;
        }

        const itemId = this.extractItemId(item, turnId);
        if (itemId) {
          const info: ToolCompleteInfo = {
            turnId,
            itemId,
            type: itemType || "tool",
            status: this.extractItemStatus(item, params),
            name: this.extractToolName(item),
            command: this.extractCommand(item),
            filePath: this.extractFilePath(item),
          };
          this.emitToolComplete(turnId, info);
          if (this.turnActiveToolItemId.get(turnId) === itemId) {
            this.turnActiveToolItemId.delete(turnId);
          }
        }
      }
      return;
    }

    if (method === "error") {
      const turnId = params?.turnId;
      const messageText = params?.error?.message;
      const willRetry = Boolean(params?.willRetry);
      if (typeof turnId === "string" && typeof messageText === "string") {
        const pending = this.pendingTurns.get(turnId);
        if (pending) {
          this.safeInvoke(() => pending.handlers.onSystem?.(`[error] ${messageText}`), `onSystem(error):${turnId}`);
        }
        if (!willRetry && !pending) {
          this.onSystemMessage(`[error] ${messageText}`);
        }
      }
      return;
    }

    if (method === "turn/completed") {
      const turn = params?.turn;
      const turnId = turn?.id;
      const threadId = params?.threadId;
      const status = turn?.status;
      const errorMessage = turn?.error?.message;

      if (typeof turnId === "string" && typeof threadId === "string" && typeof status === "string") {
        const result: TurnResult = {
          threadId,
          turnId,
          status,
          errorMessage: typeof errorMessage === "string" ? errorMessage : undefined,
        };

        const pending = this.pendingTurns.get(turnId);
        if (pending) {
          if (status !== "completed" && result.errorMessage) {
            this.safeInvoke(
              () => pending.handlers.onSystem?.(`[turn ${status}] ${result.errorMessage}`),
              `onSystem(turn-completed):${turnId}`,
            );
          }
          pending.resolve(result);
          this.pendingTurns.delete(turnId);
        } else if (status !== "cancelled") {
          this.preTurnResult.set(turnId, result);
        } else {
          this.clearTurnTransientState(turnId);
        }
        if (pending) {
          this.clearTurnTransientState(turnId);
        }
        this.clearCurrentTurnId(turnId);
      }
      return;
    }

    if (method.startsWith("codex/event/")) {
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      return;
    }

    if (method === "turn/started") {
      return;
    }
  }

  private emitTurnDelta(turnId: string, delta: string): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      this.safeInvoke(() => pending.handlers.onDelta?.(delta), `onDelta:${turnId}`);
      return;
    }

    const list = this.preTurnDeltas.get(turnId) ?? [];
    list.push(delta);
    this.preTurnDeltas.set(turnId, list);
  }

  private emitToolDelta(turnId: string, delta: string): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      this.safeInvoke(() => pending.handlers.onToolDelta?.(delta), `onToolDelta:${turnId}`);
      return;
    }

    const list = this.preTurnToolDeltas.get(turnId) ?? [];
    list.push(delta);
    this.preTurnToolDeltas.set(turnId, list);
  }

  private emitThinkingDelta(turnId: string, delta: string): void {
    this.turnHasThinkingDelta.add(turnId);
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      this.safeInvoke(() => pending.handlers.onThinkingDelta?.(delta), `onThinkingDelta:${turnId}`);
      return;
    }

    const list = this.preTurnThinkingDeltas.get(turnId) ?? [];
    list.push(delta);
    this.preTurnThinkingDeltas.set(turnId, list);
  }

  private emitToolStart(turnId: string, info: ToolStartInfo): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      this.safeInvoke(() => pending.handlers.onToolStart?.(info), `onToolStart:${turnId}`);
      return;
    }

    const list = this.preTurnToolStarts.get(turnId) ?? [];
    list.push(info);
    this.preTurnToolStarts.set(turnId, list);
  }

  private emitToolComplete(turnId: string, info: ToolCompleteInfo): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      this.safeInvoke(() => pending.handlers.onToolComplete?.(info), `onToolComplete:${turnId}`);
      return;
    }

    const list = this.preTurnToolCompletes.get(turnId) ?? [];
    list.push(info);
    this.preTurnToolCompletes.set(turnId, list);
  }

  private clearTurnTransientState(turnId: string): void {
    this.preTurnDeltas.delete(turnId);
    this.preTurnToolDeltas.delete(turnId);
    this.preTurnThinkingDeltas.delete(turnId);
    this.preTurnToolStarts.delete(turnId);
    this.preTurnToolCompletes.delete(turnId);
    this.turnHasMessageDelta.delete(turnId);
    this.turnHasThinkingDelta.delete(turnId);
    this.turnActiveToolItemId.delete(turnId);
  }

  private normalizeItemType(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/[^a-zA-Z]/g, "").toLowerCase();
  }

  private isThinkingType(itemType: string): boolean {
    return itemType.includes("thinking") || itemType.includes("reasoning");
  }

  private isThinkingMethod(method: string): boolean {
    const normalized = method.toLowerCase();
    return normalized.includes("thinking") || normalized.includes("reasoning");
  }

  private extractTextDelta(source: any): string | null {
    if (!source || typeof source !== "object") return null;
    const candidates = [
      source.delta,
      source.text,
      source.content,
      source.message,
      source.output,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
    return null;
  }

  private extractItemId(item: any, turnId: string | undefined): string {
    const direct = item?.id ?? item?.itemId;
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct;
    }
    if (typeof turnId === "string") {
      const active = this.turnActiveToolItemId.get(turnId);
      if (active) {
        return active;
      }
    }
    const turnPrefix = typeof turnId === "string" && turnId.length > 0 ? turnId : "turn";
    const sequence = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return `${turnPrefix}:${sequence}`;
  }

  private extractToolName(item: any): string | undefined {
    const direct = item?.name ?? item?.toolName ?? item?.tool?.name ?? item?.command?.name;
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }
    return undefined;
  }

  private extractCommand(item: any): string | undefined {
    const direct = item?.command ?? item?.input?.command ?? item?.rawCommand ?? item?.toolInput?.command;
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }
    return undefined;
  }

  private extractFilePath(item: any): string | undefined {
    const direct = item?.filePath
      ?? item?.path
      ?? item?.targetPath
      ?? item?.file?.path
      ?? item?.input?.path;
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }
    return undefined;
  }

  private extractItemStatus(item: any, params: any): string {
    const status = item?.status ?? params?.status ?? params?.result?.status;
    if (typeof status === "string" && status.trim().length > 0) {
      return status.trim();
    }
    return "completed";
  }

  private async request(method: string, params: any): Promise<any> {
    if (!this.process || this.process.killed) {
      throw new Error("Codex app-server is not running.");
    }

    const id = String(this.requestCounter++);

    const promise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 60_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
    });

    this.writeJson({ id, method, params });

    return await promise;
  }

  private notify(method: string, params?: any): void {
    if (params === undefined) {
      this.writeJson({ method });
      return;
    }
    this.writeJson({ method, params });
  }

  private writeJson(payload: any): void {
    if (!this.process || this.process.killed || !this.process.stdin) {
      throw new Error("Codex app-server is not running.");
    }

    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private updateThreadId(threadId: string): void {
    this.currentThreadId = threadId;
    this.onThreadIdChanged(threadId);
  }

  private clearCurrentTurnId(turnId: string): void {
    if (this.currentTurnId === turnId) {
      this.currentTurnId = null;
    }
  }

  private buildCommandCandidates(configuredCommand: string): string[] {
    const primary = configuredCommand.trim();
    const candidates: string[] = [];
    const pushUnique = (value: string): void => {
      const normalized = value.trim();
      if (!normalized) return;
      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    const primaryIsCmd = primary.toLowerCase().endsWith(".cmd");

    if (process.platform === "win32") {
      pushUnique(primary);
      if (primaryIsCmd) {
        pushUnique(primary.slice(0, -4));
      } else {
        pushUnique(`${primary}.cmd`);
      }
      pushUnique("codex.cmd");
      pushUnique("codex");
    } else {
      if (primaryIsCmd) {
        pushUnique(primary.slice(0, -4));
      }
      pushUnique(primary);
      pushUnique("codex");
      pushUnique("codex.cmd");
    }

    return candidates;
  }

  private buildSpawnEnv(): NodeJS.ProcessEnv {
    const basePath = process.env.PATH ?? "";
    const delimiter = process.platform === "win32" ? ";" : ":";
    const extras = process.platform === "win32"
      ? [
        "C:\\Program Files\\nodejs",
        "C:\\Users\\admin\\AppData\\Roaming\\npm",
      ]
      : [
        "/usr/local/bin",
        "/usr/bin",
        "/home/mirror/.local/bin",
        "/home/mirror/.nvm/versions/node/v22.14.0/bin",
      ];

    const merged = [...basePath.split(delimiter).filter((part) => part.trim().length > 0)];
    for (const part of extras) {
      if (!merged.includes(part)) {
        merged.push(part);
      }
    }

    return {
      ...process.env,
      PATH: merged.join(delimiter),
    };
  }

  private selectStartCommand(
    candidates: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): { command: string; probe: CommandProbeResult } {
    const startIndex = Math.min(this.reconnectAttempts, Math.max(0, candidates.length - 1));
    const failures: string[] = [];

    for (let offset = 0; offset < candidates.length; offset++) {
      const index = (startIndex + offset) % candidates.length;
      const candidate = candidates[index];
      const probe = this.probeCommand(candidate, env, cwd);
      this.debugLog("start:probe", {
        candidate,
        ok: probe.ok,
        detail: probe.detail,
      });
      if (probe.ok) {
        return { command: candidate, probe };
      }
      failures.push(`${candidate}: ${probe.detail}`);
    }

    const failureMessage = failures.join(" | ");
    throw new Error(`No usable codex command found. ${failureMessage}`);
  }

  private probeCommand(command: string, env: NodeJS.ProcessEnv, cwd: string): CommandProbeResult {
    try {
      const result = spawnSync(command, ["--version"], {
        cwd,
        env,
        shell: process.platform === "win32",
        windowsHide: true,
        encoding: "utf-8",
        timeout: 5_000,
      });

      if (result.error) {
        return {
          ok: false,
          detail: `${result.error.name}: ${result.error.message}`,
        };
      }

      const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
      const combined = (stdout || stderr).replace(/\s+/g, " ").trim();

      if (result.status === 0) {
        return {
          ok: true,
          detail: combined || "ok",
        };
      }

      return {
        ok: false,
        detail: `exit=${result.status ?? "unknown"} ${combined || "no output"}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        detail: message,
      };
    }
  }

  private safeInvoke(callback: () => void, label: string): void {
    try {
      callback();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.onSystemMessage(`[callback:${label}] ${reason}`);
      this.debugError("callback failure", error, { label, reason });
    }
  }

  private debugLog(event: string, payload?: unknown): void {
    if (payload === undefined) {
      console.log(`[CODEXIDIAN DEBUG] ${event}`);
      return;
    }
    console.log(`[CODEXIDIAN DEBUG] ${event} ${this.stringifyDebug(payload)}`);
  }

  private debugError(event: string, error: unknown, extra?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    const payload = {
      ...(extra ?? {}),
      message,
      stack,
    };
    console.error(`[CODEXIDIAN DEBUG] ${event} ${this.stringifyDebug(payload)}`);
  }

  private stringifyDebug(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
