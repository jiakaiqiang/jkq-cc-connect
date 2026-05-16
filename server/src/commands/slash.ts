import type { ToolExecutionMode, VibeToolId } from '../types/index.js'

export type SlashCommand =
  | { kind: 'help' }
  | { kind: 'tool-command'; tool: VibeToolId; args: string[] }
  | { kind: 'prompt'; prompt: string; mode?: ToolExecutionMode }
  | { kind: 'error'; message: string }

function tokenize(input: string) {
  const tokens: string[] = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`|([^\s]+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
    if (value) tokens.push(value)
  }

  return tokens
}

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const tokens = tokenize(trimmed)
  if (!tokens.length) return null

  const command = tokens[0].slice(1).toLowerCase()
  const args = tokens.slice(1)

  switch (command) {
    case 'help':
      return { kind: 'help' }
    case 'claude':
    case 'codex':
    case 'opencode':
      if (!args.length) {
        return { kind: 'error', message: `/${command} 后面需要跟具体命令。` }
      }
      return { kind: 'tool-command', tool: command, args }
    case 'skill': {
      const skillName = args[0]
      const skillArgs = args.slice(1).join(' ').trim()
      if (!skillName) {
        return { kind: 'error', message: '/skill 后面需要 skill 名称。' }
      }
      const prompt = `/${skillName}${skillArgs ? ` ${skillArgs}` : ''}`
      return { kind: 'prompt', prompt, mode: 'claude' }
    }
    case 'mcp': {
      const target = args[0]
      const request = args.slice(1).join(' ').trim()
      if (!target) {
        return { kind: 'error', message: '/mcp 后面需要 MCP 名称。' }
      }
      if (!request) {
        return { kind: 'error', message: '/mcp 需要附带要执行的请求内容。' }
      }
      return {
        kind: 'prompt',
        prompt: `Use the MCP server or tool named "${target}" for this request when available.\n\n${request}`,
      }
    }
    case 'mode': {
      const mode = args[0] as ToolExecutionMode | undefined
      const request = args.slice(1).join(' ').trim()
      if (!mode || !['auto', 'parallel', 'claude', 'codex', 'opencode'].includes(mode)) {
        return { kind: 'error', message: '/mode 需要指定 auto、claude、codex、opencode 或 parallel。' }
      }
      if (!request) {
        return { kind: 'error', message: '/mode 需要附带要发送的内容。' }
      }
      return { kind: 'prompt', prompt: request, mode }
    }
    default:
      return {
        kind: 'error',
        message: `未识别的命令：/${command}。可用命令有 /claude /codex /opencode /skill /mcp /mode /help`,
      }
  }
}

export function getSlashHelpText() {
  return [
    '可用命令：',
    '/claude <command...>  直接执行 Claude CLI 命令',
    '/codex <command...>   直接执行 Codex CLI 命令',
    '/opencode <command...> 直接执行 OpenCode CLI 命令',
    '/skill <name> <args...> 通过 Claude 调用对应 skill',
    '/mcp <name> <request...> 指定 MCP 名称来处理请求',
    '/mode <tool> <request...> 临时切换本次消息使用的工具',
    '/help 查看这份帮助',
  ].join('\n')
}
