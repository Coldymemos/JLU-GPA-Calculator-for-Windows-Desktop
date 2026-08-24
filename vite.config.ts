import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Tauri 构建时会注入 TAURI_ENV_* 环境变量：桌面端使用相对 base 且不注册 PWA
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? (isTauri ? './' : '/JLU-GPA-Calculator/') : '/',
  resolve: {
    alias: isTauri
      ? [
          {
            find: 'virtual:pwa-register',
            replacement: fileURLToPath(
              new URL('./src/infrastructure/pwa-register.stub.ts', import.meta.url)
            )
          }
        ]
      : []
  },
  plugins: [
    react(),
    ...(isTauri
      ? []
      : [
          VitePWA({
            registerType: 'prompt',
            includeAssets: ['favicon.svg', 'app-icon.svg'],
            manifest: {
              name: '吉林大学本科生绩点计算器',
              short_name: 'JLU GPA',
              description: '成绩仅在浏览器本地处理的绩点与均分计算器。',
              theme_color: '#8f2c3e',
              background_color: '#f5f6f7',
              display: 'standalone',
              start_url: '.',
              icons: [
                {
                  src: 'app-icon.svg',
                  sizes: 'any',
                  type: 'image/svg+xml',
                  purpose: 'any maskable'
                }
              ]
            },
            workbox: {
              navigateFallback: 'index.html',
              globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
            }
          })
        ])
  ]
}));
