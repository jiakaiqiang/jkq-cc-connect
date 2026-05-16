import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'
import { backendConfig, getDevServerWsOrigin } from './src/config/backend'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'CC Connect',
        short_name: 'CC Connect',
        description: 'Mobile Claude Code Remote Control',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: backendConfig.dev.clientPort,
    proxy: {
      '/api': backendConfig.dev.serverHttpOrigin,
      [backendConfig.paths.ws]: {
        target: getDevServerWsOrigin(),
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: backendConfig.dev.clientPort,
  },
})
