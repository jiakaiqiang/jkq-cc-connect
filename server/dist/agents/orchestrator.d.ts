import type { ToolExecutionResult } from '../cc/manager.js';
import type { AgentMention, ServerMsg, ToolAgentInfo, VibeToolInfo } from '../types/index.js';
type UserMessage = Extract<ServerMsg, {
    type: 'user';
}>;
type PublicTextMessage = Extract<ServerMsg, {
    type: 'text';
}>;
interface MentionConversationManager {
    isRunning(): boolean;
    start(projectDir: string, inputText: string, tool: VibeToolInfo['id'], options?: {
        requestedAgentName?: string | null;
        requestedAgentLabel?: string | null;
        preamble?: string;
        suppressAssistantMessageBroadcast?: boolean;
    }): Promise<ToolExecutionResult>;
}
interface MentionConversationContext {
    sessionId: string;
    projectDir: string;
    text: string;
    mentions: AgentMention[];
    tool: VibeToolInfo;
    manager: MentionConversationManager;
    onUserMessage: (message: UserMessage) => void;
    savePublicMessage: (message: PublicTextMessage) => void;
    publish: (message: PublicTextMessage) => void;
}
interface ResolvedMentions {
    tool: VibeToolInfo;
    leadAgent: ToolAgentInfo;
    collaboratorAgents: ToolAgentInfo[];
}
export declare function runMentionConversation(context: MentionConversationContext): Promise<ToolExecutionResult>;
export declare function validateMentionConversationRequest({ mentions, tools, expectedToolId, requireExecutable, }: {
    mentions: AgentMention[];
    tools: VibeToolInfo[];
    expectedToolId?: VibeToolInfo['id'];
    requireExecutable?: boolean;
}): ({
    ok: true;
} & ResolvedMentions) | {
    ok: false;
    errorMessage: string;
};
export {};
