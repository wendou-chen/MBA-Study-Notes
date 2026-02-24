"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexAppServerClient = void 0;
const child_process_1 = require("child_process");
class CodexAppServerClient {
    constructor(getSettings, getVaultPath, onThreadIdChanged, onSystemMessage) {
        this.getSettings = getSettings;
        this.getVaultPath = getVaultPath;
        this.onThreadIdChanged = onThreadIdChanged;
        this.onSystemMessage = onSystemMessage;
        this.process = null;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.requestCounter = 1;
        this.pendingRequests = new Map();
        this.pendingTurns = new Map();
        this.preTurnDeltas = new Map();
        this.preTurnToolDeltas = new Map();
        this.preTurnResult = new Map();
        this.turnHasMessageDelta = new Set();
        this.startPromise = null;
        this.disposed = false;
        this.currentThreadId = null;
    }
    getThreadId() {
        return this.currentThreadId;
    }
    setThreadId(threadId) {
        this.currentThreadId = threadId;
    }
    async restart() {
        await this.dispose();
        this.disposed = false;
        await this.start();
    }
    async dispose() {
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
    async newThread() {
        await this.start();
        const threadId = await this.startThread();
        return threadId;
    }
    async sendTurn(prompt, handlers = {}) {
        var _a;
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
        const turnId = (_a = turnResponse === null || turnResponse === void 0 ? void 0 : turnResponse.turn) === null || _a === void 0 ? void 0 : _a.id;
        if (!turnId) {
            throw new Error("turn/start did not return turn id.");
        }
        return await new Promise((resolve, reject) => {
            var _a, _b;
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
                    (_a = handlers.onDelta) === null || _a === void 0 ? void 0 : _a.call(handlers, delta);
                }
                this.preTurnDeltas.delete(turnId);
            }
            const preToolDeltas = this.preTurnToolDeltas.get(turnId);
            if (preToolDeltas && preToolDeltas.length > 0) {
                for (const delta of preToolDeltas) {
                    (_b = handlers.onToolDelta) === null || _b === void 0 ? void 0 : _b.call(handlers, delta);
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
    async start() {
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
        }
        finally {
            this.startPromise = null;
        }
    }
    async startInternal() {
        var _a, _b;
        const settings = this.getSettings();
        const cwd = this.resolveCwd(settings);
        const child = (0, child_process_1.spawn)(settings.codexCommand, ["app-server", "--listen", "stdio://"], {
            cwd,
            env: process.env,
            shell: process.platform === "win32",
            windowsHide: true,
        });
        this.process = child;
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (chunk) => {
            this.consumeStdout(chunk.toString());
        });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on("data", (chunk) => {
            this.consumeStderr(chunk.toString());
        });
        child.on("exit", (code) => {
            const msg = `Codex app-server exited (${code !== null && code !== void 0 ? code : "unknown"}).`;
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
    async ensureThread() {
        var _a, _b;
        if (this.currentThreadId) {
            return this.currentThreadId;
        }
        const settings = this.getSettings();
        const savedThreadId = settings.persistThread ? (_a = settings.lastThreadId) === null || _a === void 0 ? void 0 : _a.trim() : "";
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
                const resumedId = (_b = resumed === null || resumed === void 0 ? void 0 : resumed.thread) === null || _b === void 0 ? void 0 : _b.id;
                if (resumedId) {
                    this.updateThreadId(resumedId);
                    return resumedId;
                }
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.onSystemMessage(`Failed to resume thread, starting new one. (${msg})`);
            }
        }
        return await this.startThread();
    }
    async startThread() {
        var _a;
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
        const threadId = (_a = response === null || response === void 0 ? void 0 : response.thread) === null || _a === void 0 ? void 0 : _a.id;
        if (!threadId) {
            throw new Error("thread/start did not return thread id.");
        }
        this.updateThreadId(threadId);
        return threadId;
    }
    resolveCwd(settings) {
        const explicit = settings.workingDirectory.trim();
        if (explicit) {
            return explicit;
        }
        return this.getVaultPath();
    }
    consumeStdout(chunk) {
        var _a;
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = (_a = lines.pop()) !== null && _a !== void 0 ? _a : "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch (_b) {
                this.onSystemMessage(`[app-server/stdout] ${trimmed}`);
                continue;
            }
            this.routeIncomingMessage(parsed);
        }
    }
    consumeStderr(chunk) {
        var _a;
        this.stderrBuffer += chunk;
        const lines = this.stderrBuffer.split(/\r?\n/);
        this.stderrBuffer = (_a = lines.pop()) !== null && _a !== void 0 ? _a : "";
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
    routeIncomingMessage(message) {
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
    resolvePendingRequest(message) {
        var _a;
        const requestId = String(message.id);
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        if (Object.prototype.hasOwnProperty.call(message, "error") && message.error) {
            const err = ((_a = message.error) === null || _a === void 0 ? void 0 : _a.message) || JSON.stringify(message.error);
            pending.reject(new Error(err));
            return;
        }
        pending.resolve(message.result);
    }
    async handleServerRequest(message) {
        var _a, _b;
        const requestId = message.id;
        const method = message.method;
        const settings = this.getSettings();
        try {
            let result;
            if (method === "item/commandExecution/requestApproval") {
                result = { decision: settings.autoApproveRequests ? "accept" : "decline" };
            }
            else if (method === "item/fileChange/requestApproval") {
                result = { decision: settings.autoApproveRequests ? "accept" : "decline" };
            }
            else if (method === "item/tool/requestUserInput") {
                const answers = {};
                const questions = Array.isArray((_a = message.params) === null || _a === void 0 ? void 0 : _a.questions) ? message.params.questions : [];
                for (const q of questions) {
                    const id = typeof (q === null || q === void 0 ? void 0 : q.id) === "string" ? q.id : "";
                    if (!id) {
                        continue;
                    }
                    const options = Array.isArray(q.options) ? q.options : [];
                    if (options.length > 0 && typeof ((_b = options[0]) === null || _b === void 0 ? void 0 : _b.label) === "string") {
                        answers[id] = { answers: [options[0].label] };
                    }
                    else {
                        answers[id] = { answers: [""] };
                    }
                }
                result = { answers };
            }
            else if (method === "item/tool/call") {
                result = {
                    success: false,
                    contentItems: [{ type: "inputText", text: "Dynamic tool call is not handled by Codexidian." }],
                };
            }
            else if (method === "execCommandApproval" || method === "applyPatchApproval") {
                result = { decision: settings.autoApproveRequests ? "approved" : "denied" };
            }
            else {
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
        }
        catch (error) {
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
    handleNotification(message) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const method = message.method;
        const params = (_a = message.params) !== null && _a !== void 0 ? _a : {};
        if (method === "thread/started") {
            const threadId = (_b = params === null || params === void 0 ? void 0 : params.thread) === null || _b === void 0 ? void 0 : _b.id;
            if (typeof threadId === "string" && threadId) {
                this.updateThreadId(threadId);
            }
            return;
        }
        if (method === "item/agentMessage/delta") {
            const turnId = params === null || params === void 0 ? void 0 : params.turnId;
            const delta = params === null || params === void 0 ? void 0 : params.delta;
            if (typeof turnId === "string" && typeof delta === "string" && delta.length > 0) {
                this.turnHasMessageDelta.add(turnId);
                this.emitTurnDelta(turnId, delta);
            }
            return;
        }
        if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
            const turnId = params === null || params === void 0 ? void 0 : params.turnId;
            const delta = params === null || params === void 0 ? void 0 : params.delta;
            if (typeof turnId === "string" && typeof delta === "string" && delta.length > 0) {
                this.emitToolDelta(turnId, delta);
            }
            return;
        }
        if (method === "item/completed") {
            const turnId = params === null || params === void 0 ? void 0 : params.turnId;
            const item = params === null || params === void 0 ? void 0 : params.item;
            if (typeof turnId === "string" && (item === null || item === void 0 ? void 0 : item.type) === "agentMessage" && typeof (item === null || item === void 0 ? void 0 : item.text) === "string") {
                if (!this.turnHasMessageDelta.has(turnId) && item.text.length > 0) {
                    this.emitTurnDelta(turnId, item.text);
                }
            }
            return;
        }
        if (method === "error") {
            const turnId = params === null || params === void 0 ? void 0 : params.turnId;
            const messageText = (_c = params === null || params === void 0 ? void 0 : params.error) === null || _c === void 0 ? void 0 : _c.message;
            const willRetry = Boolean(params === null || params === void 0 ? void 0 : params.willRetry);
            if (typeof turnId === "string" && typeof messageText === "string") {
                const pending = this.pendingTurns.get(turnId);
                (_e = pending === null || pending === void 0 ? void 0 : (_d = pending.handlers).onSystem) === null || _e === void 0 ? void 0 : _e.call(_d, `[error] ${messageText}`);
                if (!willRetry && !pending) {
                    this.onSystemMessage(`[error] ${messageText}`);
                }
            }
            return;
        }
        if (method === "turn/completed") {
            const turn = params === null || params === void 0 ? void 0 : params.turn;
            const turnId = turn === null || turn === void 0 ? void 0 : turn.id;
            const threadId = params === null || params === void 0 ? void 0 : params.threadId;
            const status = turn === null || turn === void 0 ? void 0 : turn.status;
            const errorMessage = (_f = turn === null || turn === void 0 ? void 0 : turn.error) === null || _f === void 0 ? void 0 : _f.message;
            if (typeof turnId === "string" && typeof threadId === "string" && typeof status === "string") {
                const result = {
                    threadId,
                    turnId,
                    status,
                    errorMessage: typeof errorMessage === "string" ? errorMessage : undefined,
                };
                const pending = this.pendingTurns.get(turnId);
                if (pending) {
                    if (status !== "completed" && result.errorMessage) {
                        (_h = (_g = pending.handlers).onSystem) === null || _h === void 0 ? void 0 : _h.call(_g, `[turn ${status}] ${result.errorMessage}`);
                    }
                    pending.resolve(result);
                    this.pendingTurns.delete(turnId);
                }
                else {
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
    emitTurnDelta(turnId, delta) {
        var _a, _b, _c;
        const pending = this.pendingTurns.get(turnId);
        if (pending) {
            (_b = (_a = pending.handlers).onDelta) === null || _b === void 0 ? void 0 : _b.call(_a, delta);
            return;
        }
        const list = (_c = this.preTurnDeltas.get(turnId)) !== null && _c !== void 0 ? _c : [];
        list.push(delta);
        this.preTurnDeltas.set(turnId, list);
    }
    emitToolDelta(turnId, delta) {
        var _a, _b, _c;
        const pending = this.pendingTurns.get(turnId);
        if (pending) {
            (_b = (_a = pending.handlers).onToolDelta) === null || _b === void 0 ? void 0 : _b.call(_a, delta);
            return;
        }
        const list = (_c = this.preTurnToolDeltas.get(turnId)) !== null && _c !== void 0 ? _c : [];
        list.push(delta);
        this.preTurnToolDeltas.set(turnId, list);
    }
    async request(method, params) {
        if (!this.process || this.process.killed) {
            throw new Error("Codex app-server is not running.");
        }
        const id = String(this.requestCounter++);
        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, 60000);
            this.pendingRequests.set(id, { resolve, reject, timeout });
        });
        this.writeJson({ id, method, params });
        return await promise;
    }
    notify(method, params) {
        if (params === undefined) {
            this.writeJson({ method });
            return;
        }
        this.writeJson({ method, params });
    }
    writeJson(payload) {
        if (!this.process || this.process.killed || !this.process.stdin) {
            throw new Error("Codex app-server is not running.");
        }
        this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    }
    updateThreadId(threadId) {
        this.currentThreadId = threadId;
        this.onThreadIdChanged(threadId);
    }
}
exports.CodexAppServerClient = CodexAppServerClient;
