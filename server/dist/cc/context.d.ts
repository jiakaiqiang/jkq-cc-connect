import type { ConversationState, Message, VibeToolId } from '../types/index.js';
interface BuildExecutionInputOptions {
    text: string;
    targetTool: VibeToolId;
    toolHasNativeSession: boolean;
    lastSuccessfulTool: VibeToolId | null;
    handoffFromTool?: VibeToolId | null;
    conversationState: ConversationState;
    recentMessages: Message[];
}
export declare function buildExecutionInput(options: BuildExecutionInputOptions): string;
export {};
