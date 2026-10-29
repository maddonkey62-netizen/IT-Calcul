/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages는 https://<계정>.github.io/<저장소명>/ 아래에서 열리므로
// 배포 워크플로가 BASE_PATH=/<저장소명>/ 을 넘겨준다. 로컬과 Vercel은 '/'.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Diffusion Rate 계산기',
        short_name: 'Diffusion',
        description: '멤브레인 필터 Diffusion Rate (Pressure Decay) 계산·기록',
        lang: 'ko',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Apps Script 호출은 캐시하지 않는다 (동기화는 앱 코드가 직접 관리)
        navigateFallbackDenylist: [/^\/macros\//],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
