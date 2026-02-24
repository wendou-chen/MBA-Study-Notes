"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = void 0;
exports.DEFAULT_SETTINGS = {
    codexCommand: process.platform === "win32" ? "codex.cmd" : "codex",
    workingDirectory: "",
    model: "",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    autoApproveRequests: true,
    persistThread: true,
    lastThreadId: "",
};
