import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
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
const appCommitSha = (
  process.env.CF_PAGES_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.VITE_APP_COMMIT_SHA
  ?? ''
).trim().slice(0, 8)

const productFidelityFixtureFiles = [
  'british-museum-thumb.webp',
  'dishoom-thumb.webp',
  'edinburgh-castle-hero.webp',
  'edinburgh-castle-thumb.webp',
  'hotel-room-thumb.webp',
  'lner-azuma-thumb.webp',
  'tower-bridge-thumb.webp',
] as const

function productFidelityFixtureAssets(): Plugin {
  return {
    apply: 'build',
    generateBundle() {
      if (process.env.VITE_E2E_AUTH_BYPASS !== '1') return
      for (const fileName of productFidelityFixtureFiles) {
        this.emitFile({
          fileName: `fixtures/product-fidelity/${fileName}`,
          source: readFileSync(new URL(`./e2e/assets/product-fidelity/${fileName}`, import.meta.url)),
          type: 'asset',
        })
      }
    },
    name: 'tripmap-product-fidelity-fixtures',
  }
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    manifest: true,
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
          if (normalizedId.includes('/node_modules/@supabase/')) {
            return 'supabase-vendor'
          }
        },
      },
    },
  },
  define: {
    __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
    __APP_VERSION__: JSON.stringify(appVersion),
    __TRIPMAP_E2E__: JSON.stringify(process.env.VITE_E2E_AUTH_BYPASS === '1'),
    __TRIPMAP_UNIT_TEST__: false,
  },
  plugins: [
    react(),
    tailwindcss(),
    productFidelityFixtureAssets(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: '旅图 TripMap',
        short_name: '旅图',
        description:
          '复杂出境自由行的智能旅行管家：整理行程、地点与票据，让下一站、出发时间和所需资料一眼清楚。',
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: [
          '**/AiDraftPage-*.js',
          '**/GlobalAiCommandBar-*.js',
          '**/icons/icon-*.png',
          '**/jszip-*.js',
          '**/manifest.webmanifest',
          '**/maplibre-*.css',
          '**/maplibre-*.js',
          '**/ocr-*.js',
          '**/pdf*.js',
          '**/providerProxyClientCore-*.js',
          '**/workflowMutationRuntime-*.js',
          '**/worker.min-*.js',
        ],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tripmap-on-demand-assets-v1',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxAgeSeconds: 30 * 24 * 60 * 60,
                maxEntries: 80,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
        importScripts: ['/push-handler.js'],
      },
    }),
  ],
})
