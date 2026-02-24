import { ChildProcess, spawn } from "child_process";

import type { CodexidianSettings, TurnHandlers, TurnResult } from "./types";

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
  private preTurnResult = new Map<string, TurnResult>();
  private turnHasMessageDelta = new Set<string>();
  private startPromise: Promise<void> | null = null;
  private disposed = false;

  private currentThreadId: string | null = null;

  constructor(
    private readonly getSettings: () => CodexidianSettings,
    private readonly getVaultPath: () => string,
    private readonly onThreadIdChanged: (threadId: string) => void,
    private readonly onSystemMessage: (message: string) => void,
  ) {}

  getThreadId(): string | null {
    return this.currentThreadId;
  }

  setThreadId(threadId: string | null): void {
    this.currentThreadId = threadId;
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
    }

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.startPromise = null;
  }

  async newThread(): Promise<string> {
    await this.start();
    const threadId = await this.startThread();
    return threadId;
  }

  async sendTurn(prompt: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    await this.start();
    const threadId = await this.ensureThread();

    const turnResponse = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: null,
      effort: null,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    });

    const turnId = turnResponse?.turn?.id as string | undefined;
    if (!turnId) {
      throw new Error("turn/start did not return turn id.");
    }

    return await new Promise<TurnResult>((resolve, reject) => {
      const turnTimeout = setTimeout(() => {
        if (!this.pendingTurns.has(turnId)) {
          return;
        }
        this.pendingTurns.delete(turnId);
        reject(new Error("Turn timed out after 15 minutes."));
      }, 15 * 60 * 1000);

      this.pendingTurns.set(turnId, {
        handlers,
        resolve: (result) => {
          clearTimeout(turnTimeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(turnTimeout);
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

      const result = this.preTurnResult.get(turnId);
      if (result) {
        this.preTurnResult.delete(turnId);
        this.pendingTurns.delete(turnId);
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
      }

      this.process = null;
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

      if (method === "item/commandExecution/requestApproval") {
        result = { decision: settings.autoApproveRequests ? "accept" : "decline" };
      } else if (method === "item/fileChange/requestApproval") {
        result = { decision: settings.autoApproveRequests ? "accept" : "decline" };
      } else if (method === "item/tool/requestUserInput") {
        const answers: Record<string, { answers: string[] }> = {};
        const questions = Array.isArray(message.params?.questions) ? message.params.questions : [];

        for (const q of questions) {
          const id = typeof q?.id === "string" ? q.id : "";
          if (!id) {
            continue;
          }

          const options = Array.isArray(q.options) ? q.options : [];
          if (options.length > 0 && typeof options[0]?.label === "string") {
            answers[id] = { answers: [options[0].label] };
          } else {
            answers[id] = { answers: [""] };
          }
        }

        result = { answers };
      } else if (method === "item/tool/call") {
        result = {
          success: false,
          contentItems: [{ type: "inputText", text: "Dynamic tool call is not handled by Codexidian." }],
        };
      } else if (method === "execCommandApproval" || method === "applyPatchApproval") {
        result = { decision: settings.autoApproveRequests ? "approved" : "denied" };
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
        this.emitToolDelta(turnId, delta);
      }
      return;
    }

    if (method === "item/completed") {
      const turnId = params?.turnId;
      const item = params?.item;
      if (typeof turnId === "string" && item?.type === "agentMessage" && typeof item?.text === "string") {
        if (!this.turnHasMessageDelta.has(turnId) && item.text.length > 0) {
          this.emitTurnDelta(turnId, item.text);
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
        } else {
          this.preTurnResult.set(turnId, result);
        }

        this.turnHasMessageDelta.delete(turnId);
      }
      return;
    }

    if (method.startsWith("codex/event/")) {
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      return;
    }

    if (method === "item/started" || method === "turn/started") {
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
}
