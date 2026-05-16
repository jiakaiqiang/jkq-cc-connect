import type Database from 'better-sqlite3';
import type { ConversationState, SessionInfo, ToolSessionRef, VibeToolId } from '../types/index.js';
interface CreateSessionInput {
    name?: string;
    projectDir: string;
}
interface ConversationStatePatch {
    canonicalSummary?: string;
    workingMemory?: string;
    currentGoal?: string;
    touchedFiles?: string[];
    openQuestions?: string[];
    recentDecisions?: string[];
    lastSuccessfulTool?: VibeToolId | null;
    lastSummarizedSeq?: number;
}
export declare function createSession(input: CreateSessionInput, database?: Database.Database): SessionInfo;
export declare function getActiveSession(database?: Database.Database): SessionInfo | null;
export declare function getSession(id: string, database?: Database.Database): SessionInfo | null;
export declare function listSessions(database?: Database.Database): SessionInfo[];
export declare function touchSession(id: string, database?: Database.Database): void;
export declare function getToolSessionRefs(sessionId: string, database?: Database.Database): ToolSessionRef[];
export declare function getToolSessionMap(sessionId: string, database?: Database.Database): Partial<Record<VibeToolId, string>>;
export declare function setToolSessionId(sessionId: string, toolId: VibeToolId, nativeSessionId: string, lastStatus?: string | null, database?: Database.Database): void;
export declare function setClaudeSessionId(id: string, claudeSessionId: string, database?: Database.Database): void;
export declare function getConversationState(sessionId: string, database?: Database.Database): ConversationState;
export declare function upsertConversationState(sessionId: string, patch: ConversationStatePatch, database?: Database.Database): ConversationState;
export declare function setSessionName(id: string, name: string, database?: Database.Database): SessionInfo | null;
export declare function updateSessionNameFromFirstMessage(id: string, firstMessage: string, database?: Database.Database): SessionInfo | null;
export declare function archiveSession(id: string, database?: Database.Database): void;
export declare function deleteSession(id: string, database?: Database.Database): boolean;
export {};
