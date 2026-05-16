import type Database from 'better-sqlite3';
import type { ConversationState, Message } from '../types/index.js';
interface ConversationStateSummaryPatch {
    canonicalSummary: string;
    workingMemory: string;
    touchedFiles: string[];
    openQuestions: string[];
    recentDecisions: string[];
    lastSummarizedSeq: number;
}
export declare function summarizeConversationState(messages: Message[], state: ConversationState): ConversationStateSummaryPatch;
export declare function refreshConversationStateFromRecentHistory(sessionId: string, database?: Database.Database): ConversationState;
export {};
