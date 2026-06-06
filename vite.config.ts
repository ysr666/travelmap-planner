import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

type PackageMetadata = {
  version?: string
  tripMapBuild?: number | string
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageMetadata

const packageVersion = packageMetadata.version ?? process.env.npm_package_version ?? '0.0.0'
const tripMapBuild = packageMetadata.tripMapBuild
const appVersion = tripMapBuild === undefined ? packageVersion : `${packageVersion}.${tripMapBuild}`

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/')
          if (normalizedId.includes('/node_modules/maplibre-gl/')) {
            return 'maplibre'
          }
          if (normalizedId.includes('/node_modules/jszip/')) {
            return 'jszip'
          }
          if (normalizedId.includes('/node_modules/pdfjs-dist/')) {
            return 'pdf-ocr'
          }
          if (
            normalizedId.includes('/node_modules/tesseract.js/') ||
            normalizedId.includes('/node_modules/@tesseract.js-data/')
          ) {
            return 'ocr'
          }
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: '旅图 TripMap',
        short_name: '旅图',
        description: '本地优先的出国旅行行程、地图路线、交通记录与票据管理工具。',
        lang: 'zh-CN',
        start_url: '/#/home',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1677ff',
        background_color: '#eef3f8',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
})
