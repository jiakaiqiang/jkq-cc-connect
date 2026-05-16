// ===== WebSocket Message Types =====

export type CCStatus = 'idle' | 'thinking' | 'executing' | 'waiting_confirm'
export type VibeToolId = 'claude' | 'codex' | 'opencode'
export type ToolExecutionMode = 'auto' | 'parallel' | VibeToolId
export type VibeToolState = 'ready' | 'limited' | 'error' | 'missing'
export type MessageSource = VibeToolId | 'system'
export type OrchestrationStep = 'user_request' | 'agent_to_agent' | 'agent_reply' | 'agent_to_user'

export type MessageType =
  | 'user'
  | 'text' | 'thinking' | 'thinking_done'
  | 'code' | 'diff'
  | 'tool_use' | 'tool_result'
  | 'confirm_request'
  | 'error' | 'status'

export interface Message {
  id: string
  sessionId: string
  type: MessageType
  content: string
  metadata: Record<string, unknown>
  seq: number
  createdAt: string
}

export interface SessionInfo {
  id: string
  name: string
  projectDir: string
  claudeSessionId: string | null
  createdAt: string
  lastActive: string
  status: 'active' | 'archived'
}

export interface ToolSessionRef {
  toolId: VibeToolId
  nativeSessionId: string
  lastUsedAt: string
  lastStatus: string | null
}

export interface ConversationState {
  sessionId: string
  canonicalSummary: string
  workingMemory: string
  currentGoal: string
  touchedFiles: string[]
  openQuestions: string[]
  recentDecisions: string[]
  lastSuccessfulTool: VibeToolId | null
  lastSummarizedSeq: number
  updatedAt: string
}

export interface MessagePage {
  messages: Message[]
  hasMore: boolean
  oldestSeq: number | null
}

export interface FileRoot {
  id: string
  name: string
  path: string
}

export interface AppSettings {
  allowedRoots: string[]
}

export interface ToolAgentInfo {
  id: string
  name: string
  statusText: string
  state: VibeToolState
  description: string
  capabilities: string[]
  markdownTitle?: string
  markdownPath?: string
  markdownContent?: string
}

export interface VibeToolInfo {
  id: VibeToolId
  label: string
  command: string
  version: string | null
  installed: boolean
  configured: boolean
  authenticated: boolean
  state: VibeToolState
  statusText: string
  detail: string
  supportsExecution: boolean
  supportsParallel: boolean
  agentCount: number
  agents: ToolAgentInfo[]
}

export interface ToolRoutePlan {
  mode: ToolExecutionMode
  selectedTools: VibeToolId[]
  summary: string
  blockedReason?: string
}

export interface ToolRouteContext {
  lastSuccessfulTool?: VibeToolId | null
  availableSessionTools?: VibeToolId[]
}

export type ToolFailureKind = 'auth' | 'network' | 'model' | 'unavailable' | 'unknown'

export interface AgentMention {
  toolId: VibeToolId
  agentId: string
  name: string
  order: number
}

export interface OrchestrationMetadata {
  senderType: 'user' | 'agent' | 'system'
  senderAgentId: string
  senderAgentName: string
  targetAgentId: string
  targetAgentName: string
  orchestrationStep: OrchestrationStep
}

// ===== Client → Server =====
export type ClientMsg =
  | { type: 'auth'; token: string }
  | { type: 'join_session'; sessionId: string }
  | { type: 'set_mode'; sessionId: string; mode: ToolExecutionMode }
  | { type: 'input'; text: string; sessionId: string; mode?: ToolExecutionMode; mentions?: AgentMention[] }
  | { type: 'confirm'; requestId: string; allow: boolean; sessionId?: string }
  | { type: 'cancel'; sessionId?: string }
  | { type: 'ping' }

// ===== Server → Client =====
export type ServerMsg =
  | { type: 'auth_ok'; session: SessionInfo }
  | { type: 'auth_error'; message: string }
  | { type: 'mode_changed'; mode: ToolExecutionMode; reason?: string }
  | { type: 'session_updated'; session: SessionInfo }
  | { type: 'user'; content: string; messageId: string; senderType?: 'user'; orchestrationStep?: 'user_request' }
  | ({ type: 'text'; content: string; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'thinking'; content: string; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'thinking_done'; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'code'; lang: string; content: string; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'diff'; content: string; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'tool_use'; toolName: string; toolInput: Record<string, unknown>; messageId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | ({ type: 'tool_result'; content: string; messageId: string; parentId: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | { type: 'confirm_request'; requestId: string; message: string; toolName: string }
  | ({ type: 'error'; message: string; source?: MessageSource; sourceLabel?: string; sourceAgent?: string; sourceAgentLabel?: string } & Partial<OrchestrationMetadata>)
  | { type: 'status'; state: CCStatus }
  | { type: 'session_state'; messages: Message[]; session: SessionInfo; hasMore: boolean; oldestSeq: number | null }
  | { type: 'pong' }

// ===== HTTP API Types =====
export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt: string
  selectable?: boolean
}

export interface FileContent {
  path: string
  content: string
  language: string
  size: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
