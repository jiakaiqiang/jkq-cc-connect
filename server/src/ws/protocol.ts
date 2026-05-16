import type { ClientMsg, ServerMsg } from '../types/index.js'

export function parseClientMessage(data: string): ClientMsg | null {
  try {
    const msg = JSON.parse(data)
    if (!msg.type) return null
    return msg as ClientMsg
  } catch {
    return null
  }
}

export function serializeServerMsg(msg: ServerMsg): string {
  return JSON.stringify(msg)
}
