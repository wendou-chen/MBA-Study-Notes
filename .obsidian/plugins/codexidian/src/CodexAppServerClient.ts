import { ChildProcess, spawn } from "child_process";

import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexidianSettings,
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

  private currentThreadId: string | null = null;
  private currentTurnId: string | null = null;

  constructor(
    private readonly getSettings: () => CodexidianSettings,
    private readonly getVaultPath: () => string,
    private readonly onThreadIdChanged: (threadId: string) => void,
    private readonly onSystemMessage: (message: string) => void,
    private readonly onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalDecision>,
    private readonly onUserInputRequest?: (request: UserInputRequest) => Promise<UserInputResponse>,
  ) {}

  getThreadId(): string | null {
    return this.currentThreadId;
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
    await this.start();
  }

  async dispose(): Promise<void> {
    this.disposed = true;

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
    options?: { model?: string; effort?: string },
  ): Promise<TurnResult> {
    await this.start();
    const threadId = await this.ensureThread();

    const turnResponse = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: options?.model?.trim() || null,
      effort: options?.effort || null,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    });

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
          handlers.onDelta?.(delta);
        }
        this.preTurnDeltas.delete(turnId);
      }

      const preToolDeltas = this.preTurnToolDeltas.get(turnId);
      if (preToolDeltas && preToolDeltas.length > 0) {
        for (const delta of preToolDeltas) {
          handlers.onToolDelta?.(delta);
        }
        this.preTurnToolDeltas.delete(turnId);
      }

      const preThinkingDeltas = this.preTurnThinkingDeltas.get(turnId);
      if (preThinkingDeltas && preThinkingDeltas.length > 0) {
        for (const delta of preThinkingDeltas) {
          handlers.onThinkingDelta?.(delta);
        }
        this.preTurnThinkingDeltas.delete(turnId);
      }

      const preToolStarts = this.preTurnToolStarts.get(turnId);
      if (preToolStarts && preToolStarts.length > 0) {
        for (const info of preToolStarts) {
          handlers.onToolStart?.(info);
        }
        this.preTurnToolStarts.delete(turnId);
      }

      const preToolCompletes = this.preTurnToolCompletes.get(turnId);
      if (preToolCompletes && preToolCompletes.length > 0) {
        for (const info of preToolCompletes) {
          handlers.onToolComplete?.(info);
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
    if (this.process) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    const settings = this.getSettings();
    const cwd = this.resolveCwd(settings);

    const child = spawn(settings.codexCommand, ["app-server", "--listen", "stdio://"], {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    this.process = child;

    child.stdout?.on("data", (chunk) => {
      this.consumeStdout(chunk.toString());
    });

    child.stderr?.on("data", (chunk) => {
      this.consumeStderr(chunk.toString());
    });

    child.on("exit", (code) => {
      const msg = `Codex app-server exited (${code ?? "unknown"}).`;
      if (!this.disposed) {
        this.onSystemMessage(msg);
      }

      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(msg));
        this.pendingRequests.delete(id);
      }

      for (const [turnId, turn] of this.pendingTurns) {
        turn.reject(new Error(msg));
        this.pendingTurns.delete(turnId);
        this.clearTurnTransientState(turnId);
        this.clearCurrentTurnId(turnId);
      }

      this.process = null;
      this.currentTurnId = null;
    });

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
        this.onSystemMessage(`Failed to resume thread, starting new one. (${msg})`);
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
    return threadId;
  }

  private resolveCwd(settings: CodexidianSettings): string {
    const explicit = settings.workingDirectory.trim();
    if (explicit) {
      return explicit;
    }
    return this.getVaultPath();
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
        const decision = await this.resolveApprovalDecision(approvalRequest, settings.autoApproveRequests);

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
        result = {
          success: false,
          contentItems: [{ type: "inputText", text: "Dynamic tool call is not handled by Codexidian." }],
        };
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

  private async resolveApprovalDecision(
    request: ApprovalRequest,
    autoApproveRequests: boolean,
  ): Promise<ApprovalDecision> {
    const requestSummary = this.buildApprovalSummary(request);

    if (autoApproveRequests) {
      this.onSystemMessage(`[approval] Auto-approved ${requestSummary}`);
      return "accept";
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
        pending?.handlers.onSystem?.(`[error] ${messageText}`);
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
            pending.handlers.onSystem?.(`[turn ${status}] ${result.errorMessage}`);
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
      pending.handlers.onDelta?.(delta);
      return;
    }

    const list = this.preTurnDeltas.get(turnId) ?? [];
    list.push(delta);
    this.preTurnDeltas.set(turnId, list);
  }

  private emitToolDelta(turnId: string, delta: string): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      pending.handlers.onToolDelta?.(delta);
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
      pending.handlers.onThinkingDelta?.(delta);
      return;
    }

    const list = this.preTurnThinkingDeltas.get(turnId) ?? [];
    list.push(delta);
    this.preTurnThinkingDeltas.set(turnId, list);
  }

  private emitToolStart(turnId: string, info: ToolStartInfo): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      pending.handlers.onToolStart?.(info);
      return;
    }

    const list = this.preTurnToolStarts.get(turnId) ?? [];
    list.push(info);
    this.preTurnToolStarts.set(turnId, list);
  }

  private emitToolComplete(turnId: string, info: ToolCompleteInfo): void {
    const pending = this.pendingTurns.get(turnId);
    if (pending) {
      pending.handlers.onToolComplete?.(info);
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
}
