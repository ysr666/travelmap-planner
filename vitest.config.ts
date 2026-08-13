import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __TRIPMAP_E2E__: false,
    __TRIPMAP_UNIT_TEST__: true,
  },
  resolve: {
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/playwright-report/**', '**/test-results/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/vite-env.d.ts'],
    },
  },
})
