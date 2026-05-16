import type { ServerMsg, CCStatus, ToolFailureKind, VibeToolId } from '../types/index.js';
type BroadcastFn = (msg: ServerMsg) => void;
export interface ToolExecutionResult {
    ok: boolean;
    tool: VibeToolId;
    producedOutput: boolean;
    recoverable: boolean;
    failureKind?: ToolFailureKind;
    errorMessage?: string;
    assistantText?: string;
}
export interface ToolExecutionOptions {
    requestedAgentName?: string | null;
    requestedAgentLabel?: string | null;
    preamble?: string;
}
export declare class CCManager {
    private proc;
    private parser;
    private broadcast;
    private status;
    private activeTool;
    private activeAgentName;
    private activeAgentLabel;
    private claudeSessionId;
    private codexSessionId;
    private openCodeSessionId;
    private pendingBuffer;
    private pendingResolve;
    setBroadcast(fn: BroadcastFn): void;
    getStatus(): CCStatus;
    getTool(): VibeToolId | null;
    getSessionId(): string | null;
    getAgentName(): string | null;
    getAgentLabel(): string | null;
    hydrateToolSessions(sessionIds: Partial<Record<VibeToolId, string | null>>): void;
    getToolSessionSnapshot(): Partial<Record<VibeToolId, string | null>>;
    isRunning(): boolean;
    start(projectDir: string, inputText: string, tool?: VibeToolId, options?: ToolExecutionOptions): Promise<ToolExecutionResult>;
    startCommand(projectDir: string, tool: VibeToolId, args: string[]): Promise<boolean>;
    private startClaude;
    private startCodex;
    private startOpenCode;
    private tryCaptureClaudeSessionId;
    private buildExecutionInput;
    private setDefaultAgent;
    private extractRequestedAgent;
    private resolveCommand;
    private resolveSpawnArgs;
    private isAssistantLikeMessage;
    private handleCodexEvent;
    private handleOpenCodeEvent;
    stop(): Promise<void>;
    write(_text: string): void;
    sendConfirm(_requestId: string, _allow: boolean): void;
    cancel(): void;
    private setStatus;
}
export {};
