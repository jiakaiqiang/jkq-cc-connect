import type Database from 'better-sqlite3';
import type { Message, MessagePage, MessageType } from '../types/index.js';
export declare const DEFAULT_MESSAGE_WINDOW = 80;
export declare function saveMessage(sessionId: string, type: MessageType, content: string, metadata?: Record<string, unknown>, messageId?: string, database?: Database.Database): Message;
export declare function appendMessageContent(id: string, chunk: string): void;
export declare function getMessages(sessionId: string, database?: Database.Database): Message[];
export declare function getRecentMessagesWindow(sessionId: string, limit?: number, database?: Database.Database): MessagePage;
export declare function getMessagesBefore(sessionId: string, beforeSeq: number, limit?: number, database?: Database.Database): MessagePage;
