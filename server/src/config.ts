import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { logger } from './utils/logger.js'

const CONFIG_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.jkq-cc-connect')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// 这份配置文件只放“部署后仍然需要保留”的运行时数据，
// 例如端口、允许访问的目录、密码哈希与 JWT 密钥。
// 它和前端的构建配置不同，目的是让桌面端重启后仍能延续之前的设置。
interface ConfigData {
  port: number
  projectDir: string
  allowedRoots: string[]
  passwordHash: string | null
  jwtSecret: string
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

// 启动时优先读取用户本地配置；如果配置不存在或损坏，就生成一份安全的默认值。
// 默认 allowedRoots 会指向当前工作目录，保证第一次启动也能立刻创建 session。
function loadConfig(): ConfigData {
  ensureConfigDir()
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    } catch {
      logger.warn('Config file corrupted, creating new one')
    }
  }
  const config: ConfigData = {
    port: 3000,
    projectDir: process.cwd(),
    allowedRoots: [process.cwd()],
    passwordHash: null,
    jwtSecret: randomBytes(32).toString('hex'),
  }
  saveConfig(config)
  return config
}

function saveConfig(config: ConfigData) {
  ensureConfigDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

let config = normalizeConfig(loadConfig())

// 历史配置可能缺少 allowedRoots，这里统一补齐，
// 避免后续文件浏览接口遇到空数组时还要到处做兜底判断。
function normalizeConfig(value: ConfigData): ConfigData {
  const allowedRoots = value.allowedRoots?.length ? value.allowedRoots : [value.projectDir]
  return { ...value, allowedRoots }
}

export function getConfig(): Readonly<ConfigData> {
  return config
}

export function updateConfig(partial: Partial<ConfigData>) {
  config = normalizeConfig({ ...config, ...partial })
  saveConfig(config)
}

export function getDbPath(): string {
  return join(CONFIG_DIR, 'cc-connect.db')
}
