import type { ToolExecutionMode, VibeToolId } from '../types/index.js';
export type SlashCommand = {
    kind: 'help';
} | {
    kind: 'tool-command';
    tool: VibeToolId;
    args: string[];
} | {
    kind: 'prompt';
    prompt: string;
    mode?: ToolExecutionMode;
} | {
    kind: 'error';
    message: string;
};
export declare function parseSlashCommand(input: string): SlashCommand | null;
export declare function getSlashHelpText(): string;
