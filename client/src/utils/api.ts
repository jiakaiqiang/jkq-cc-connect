import { getApiBase, getServerRequirementMessage, shouldRequireConfiguredServer } from './server'
import { backendConfig } from '@/config/backend'

// 每次请求都从 localStorage 现取 token，而不是在模块初始化时缓存。
// 这样登录、退出登录、切换服务地址后，不需要刷新页面也能拿到最新凭证。
function getHeaders(): Record<string, string> {
  const token = localStorage.getItem('cc-token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function request<T>(url: string, options?: RequestInit, baseOverride?: string, includeAuth = true): Promise<T> {
  const base = baseOverride ?? getApiBase()
  if (!base && shouldRequireConfiguredServer()) {
    throw new Error(getServerRequirementMessage())
  }

  // 后端统一返回 { success, data, error } 结构，这里一次性做掉通用处理：
  // 1. 拼 base URL
  // 2. 带上 JSON 头和鉴权头
  // 3. 把 HTTP 错误和业务错误都折叠成抛异常
  const res = await fetch(`${base}${url}`, {
    ...options,
    headers: { ...(includeAuth ? getHeaders() : { 'Content-Type': 'application/json' }), ...options?.headers },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`)
  return json.data as T
}

export const api = {
  // 这里保留一层语义化包装，而不是让页面直接写 fetch。
  // 好处是页面只关心“我要做什么”，不用重复记每个接口的路径和方法。
  login(password: string): Promise<{ token: string }> {
    return request(backendConfig.paths.api.auth, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  },

  pingServer(serverBase?: string): Promise<{ status: string; serverTime: string }> {
    return request(backendConfig.paths.api.health, undefined, serverBase, false)
  },

  getFileRoots(): Promise<import('@/types').FileRoot[]> {
    return request(backendConfig.paths.api.fileRoots)
  },

  getSettings(): Promise<import('@/types').AppSettings> {
    return request(backendConfig.paths.api.settings)
  },

  getVibeTools(): Promise<import('@/types').VibeToolInfo[]> {
    return request(backendConfig.paths.api.vibeTools)
  },

  updateSettings(allowedRoots: string[]): Promise<import('@/types').AppSettings> {
    return request(backendConfig.paths.api.settings, {
      method: 'PUT',
      body: JSON.stringify({ allowedRoots }),
    })
  },

  changePassword(newPassword: string): Promise<void> {
    return request(backendConfig.paths.api.authPassword, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    })
  },

  getSessions(): Promise<import('@/types').SessionInfo[]> {
    return request(backendConfig.paths.api.sessions)
  },

  getSession(id: string): Promise<{ session: import('@/types').SessionInfo; messages: import('@/types').Message[]; hasMore: boolean; oldestSeq: number | null }> {
    return request(`${backendConfig.paths.api.sessions}/${id}`)
  },

  getSessionMessages(id: string, beforeSeq: number, limit = 40): Promise<import('@/types').MessagePage> {
    return request(`${backendConfig.paths.api.sessions}/${id}/messages?beforeSeq=${encodeURIComponent(beforeSeq)}&limit=${encodeURIComponent(limit)}`)
  },

  getSessionMemory(id: string): Promise<import('@/types').ConversationState> {
    return request(`${backendConfig.paths.api.sessionMemory}/${id}/memory`)
  },

  createSession(projectDir: string, name?: string): Promise<import('@/types').SessionInfo> {
    return request(backendConfig.paths.api.sessions, {
      method: 'POST',
      body: JSON.stringify({ projectDir, name }),
    })
  },

  archiveSession(id: string): Promise<import('@/types').SessionInfo> {
    return request(`${backendConfig.paths.api.sessions}/${id}/archive`, {
      method: 'PATCH',
    })
  },

  deleteSession(id: string): Promise<{ id: string }> {
    return request(`${backendConfig.paths.api.sessions}/${id}`, {
      method: 'DELETE',
    })
  },

  listFiles(rootId: string, path = '.'): Promise<import('@/types').FileEntry[]> {
    return request(`${backendConfig.paths.api.files}?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`)
  },

  getFileContent(rootId: string, path: string): Promise<import('@/types').FileContent> {
    return request(`${backendConfig.paths.api.fileContent}?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`)
  },
}
