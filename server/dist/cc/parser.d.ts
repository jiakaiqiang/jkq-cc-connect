import type { ServerMsg } from '../types/index.js';
type MsgEmitter = (msg: ServerMsg) => void;
export declare class CCOutputParser {
    private buffer;
    private lastStatus;
    private pendingToolUses;
    private sawStreamedText;
    private sawStreamedThinking;
    reset(): void;
    feed(data: string, emit: MsgEmitter): void;
    private processLine;
    private handleEvent;
    private handleSystemEvent;
    private handleStreamEvent;
    private handleContentBlockStart;
    private handleContentBlockDelta;
    private handleContentBlockStop;
    private handleAssistantEvent;
    private handleUserEvent;
    private emitStatus;
}
export {};
