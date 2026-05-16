import type { ClientMsg, ServerMsg } from '../types/index.js';
export declare function parseClientMessage(data: string): ClientMsg | null;
export declare function serializeServerMsg(msg: ServerMsg): string;
