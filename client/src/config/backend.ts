// client 侧所有“需要访问后端”的地址都集中放在这里管理。
// 这样无论是 REST 路径、WebSocket 路径、开发代理，还是示例服务地址，
// 后面要改端口/前缀时都只需要改这一处。
export const backendConfig = {
  storage: {
    serverBaseKey: 'cc-server-base',
    defaultServerEnvKey: 'VITE_DEFAULT_SERVER_URL',
  },
  examples: {
    lanServerBase: 'http://192.168.1.8:3000',
  },
  dev: {
    clientPort: 5173,
    serverHttpOrigin: 'http://localhost:3000',
  },
  paths: {
    ws: '/ws',
    api: {
      health: '/api/health',
      auth: '/api/auth',
      authPassword: '/api/auth/password',
      fileRoots: '/api/file-roots',
      settings: '/api/settings',
      vibeTools: '/api/vibe-tools',
      sessions: '/api/sessions',
      sessionMemory: '/api/sessions',
      files: '/api/files',
      fileContent: '/api/files/content',
    },
  },
} as const

// Vite 的 ws 代理要求单独传入 ws:// 前缀，这里从 http 开发地址派生，
// 避免在 vite.config.ts 再手写一份容易漂移的地址。
export function getDevServerWsOrigin() {
  return backendConfig.dev.serverHttpOrigin.replace(/^http/i, 'ws')
}
