import type { ConversationState, Message, VibeToolId } from '../types/index.js'

interface BuildExecutionInputOptions {
  text: string
  targetTool: VibeToolId
  toolHasNativeSession: boolean
  lastSuccessfulTool: VibeToolId | null
  handoffFromTool?: VibeToolId | null
  conversationState: ConversationState
  recentMessages: Message[]
}

function toolLabel(tool: VibeToolId | null | undefined) {
  switch (tool) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'opencode':
      return 'OpenCode'
    default:
      return ''
  }
}

function compactText(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function summarizeRecentMessages(messages: Message[], currentInput: string) {
  const lines: string[] = []

  for (const message of messages.slice(-6)) {
    const content = compactText(message.content)
    if (!content) continue
    if (message.type === 'user' && content === compactText(currentInput)) continue

    const role = message.type === 'user'
      ? '用户'
      : message.metadata.sourceLabel
        ? String(message.metadata.sourceLabel)
        : '系统'

    lines.push(`- ${role}: ${content}`)
  }

  return lines
}

export function buildExecutionInput(options: BuildExecutionInputOptions) {
  const {
    text,
    targetTool,
    toolHasNativeSession,
    lastSuccessfulTool,
    handoffFromTool,
    conversationState,
    recentMessages,
  } = options

  const continuingSameTool = targetTool === lastSuccessfulTool && toolHasNativeSession && !handoffFromTool
  if (continuingSameTool) return text

  const sections: string[] = []
  const workingMemory = compactText(conversationState.workingMemory, 320)
  const summary = compactText(conversationState.canonicalSummary, 300)
  const goal = compactText(conversationState.currentGoal, 160)
  const recent = summarizeRecentMessages(recentMessages, text)
  const recentDecisions = conversationState.recentDecisions.slice(0, 4).map(item => compactText(item, 120)).filter(Boolean)
  const touchedFiles = conversationState.touchedFiles.slice(0, 5).map(file => compactText(file, 120)).filter(Boolean)
  const openQuestions = conversationState.openQuestions.slice(0, 4).map(item => compactText(item, 120)).filter(Boolean)

  if (handoffFromTool && handoffFromTool !== targetTool) {
    sections.push(`当前是从 ${toolLabel(handoffFromTool)} 切换到 ${toolLabel(targetTool)} 的上下文交接。`)
  } else if (lastSuccessfulTool && lastSuccessfulTool !== targetTool) {
    sections.push(`请承接来自 ${toolLabel(lastSuccessfulTool)} 的既有上下文继续处理。`)
  } else if (!toolHasNativeSession) {
    sections.push(`当前工具没有可恢复的原生会话，请基于以下紧凑上下文继续。`)
  }

  if (workingMemory) {
    sections.push(`工作记忆：${workingMemory}`)
  }

  if (summary) {
    sections.push(`会话摘要：${summary}`)
  }

  if (goal && goal !== compactText(text, 160)) {
    sections.push(`当前目标：${goal}`)
  }

  if (touchedFiles.length) {
    sections.push(`已改文件：${touchedFiles.join('、')}`)
  }

  if (openQuestions.length) {
    sections.push(`待解决问题：${openQuestions.join('；')}`)
  }

  if (recentDecisions.length) {
    sections.push(`近期决策：${recentDecisions.join('；')}`)
  }

  if (recent.length) {
    sections.push(`最近对话：\n${recent.join('\n')}`)
  }

  if (!sections.length) return text

  return [
    '[CONTEXT HANDOFF]',
    sections.join('\n\n'),
    '',
    '[LATEST USER REQUEST]',
    text,
  ].join('\n')
}
