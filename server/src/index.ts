import { createServer } from 'node:http'
import os from 'node:os'
import { createApp } from './http/server.js'
import { WSGateway } from './ws/gateway.js'
import { initDb } from './store/database.js'
import { ensurePassword } from './http/auth.js'
import { getConfig } from './config.js'
import { logger } from './utils/logger.js'

// 收集当前机器的局域网 IPv4 地址，启动时打印给手机/平板访问使用。
// 这里故意过滤掉 internal 地址，避免把 127.0.0.1 这类只对本机有效的地址混进来。
function getLocalIPs(): string[] {
  const nets = os.networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address)
      }
    }
  }
  return ips
}

// 服务启动顺序保持很明确：
// 1. 先初始化数据库，确保后续路由和 WS 能立即读写 session/message。
// 2. 再准备密码和 HTTP/WS 服务。
// 3. 最后统一监听端口，并把本机与局域网访问地址打出来。
initDb()

const password = ensurePassword()

const app = createApp()
const httpServer = createServer(app)

const gateway = new WSGateway()
gateway.init(httpServer)

const config = getConfig()
httpServer.listen(config.port, '0.0.0.0', () => {
  const ips = getLocalIPs()
  logger.info(`CC Connect server running on port ${config.port}`)
  logger.info('Access URLs:')
  logger.info(`  Local:   http://localhost:${config.port}`)
  for (const ip of ips) {
    logger.info(`  Network: http://${ip}:${config.port}`)
  }
  if (password) {
    logger.info(`  Initial password: ${password}`)
  }
})
