import { backendConfig } from '@/config/backend'

const STORAGE_KEY = backendConfig.storage.serverBaseKey
const IMPORT_META_ENV = (typeof import.meta !== 'undefined'
  ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  : undefined)
const DEFAULT_SERVER_URL = typeof IMPORT_META_ENV?.[backendConfig.storage.defaultServerEnvKey] === 'string'
  ? IMPORT_META_ENV[backendConfig.storage.defaultServerEnvKey]!.trim()
  : ''

function isBrowserHttpOrigin() {
  return location.protocol === 'http:' || location.protocol === 'https:'
}

// 浏览器版默认直接使用“当前打开这个页面的站点”作为后端地址；
// 只有 APK/原生壳这种没有同源概念的场景，才需要用户手动配置电脑地址。
export function getCurrentOriginServerBase() {
  return isBrowserHttpOrigin() ? location.origin : ''
}

// 统一把用户输入的服务地址清洗成标准 base URL：
// - 自动补 http://
// - 去掉 path/search/hash
// - 去掉末尾多余斜杠
// 这样后续拼接 /api、/ws 时行为会稳定很多。
function normalizeServerBase(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  try {
    const url = new URL(candidate)
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function getConfiguredServerBase() {
  const stored = localStorage.getItem(STORAGE_KEY)?.trim()
  if (stored) return normalizeServerBase(stored)
  if (DEFAULT_SERVER_URL) return normalizeServerBase(DEFAULT_SERVER_URL)
  return ''
}

export function setConfiguredServerBase(value: string) {
  const normalized = normalizeServerBase(value)
  if (normalized) {
    localStorage.setItem(STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
  return normalized
}

export function getApiBase() {
  // 浏览器环境走同源，不额外拼域名，便于反向代理和同站部署。
  if (isBrowserHttpOrigin()) return ''

  const configured = getConfiguredServerBase()
  if (configured) return configured
  return ''
}

export function getWebSocketUrl() {
  if (isBrowserHttpOrigin()) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${location.host}${backendConfig.paths.ws}`
  }

  // 原生壳场景则根据用户配置的电脑地址派生 ws:// 或 wss://。
  const configured = getConfiguredServerBase()
  if (configured) {
    const url = new URL(configured)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = backendConfig.paths.ws
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  return ''
}

export function getServerRequirementMessage() {
  return `请先配置电脑服务地址，例如 ${backendConfig.examples.lanServerBase}`
}

export function shouldRequireConfiguredServer() {
  return !isBrowserHttpOrigin()
}
