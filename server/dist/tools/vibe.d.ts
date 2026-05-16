import type { ToolExecutionMode, ToolRouteContext, ToolRoutePlan, VibeToolId, VibeToolInfo } from '../types/index.js';
export declare function getVibeTools(force?: boolean): VibeToolInfo[];
export declare function getFallbackTools(text: string, failedTool: VibeToolId, tools?: VibeToolInfo[]): VibeToolId[];
export declare function planToolRoute(text: string, mode: ToolExecutionMode | undefined, tools?: VibeToolInfo[], context?: ToolRouteContext): ToolRoutePlan;
