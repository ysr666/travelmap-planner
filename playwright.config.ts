import { defineConfig } from '@playwright/test'
import { cpus } from 'node:os'

const playwrightProxy = process.env.PLAYWRIGHT_PROXY?.trim()
const playwrightChannel = process.env.PLAYWRIGHT_CHANNEL?.trim()
const playwrightPort = resolvePort()
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`
const playwrightWorkers = resolveWorkerCount()
const reuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  maxFailures: process.env.CI ? 10 : 0,
  retries: process.env.CI ? 1 : 0,
  workers: playwrightWorkers,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: playwrightBaseUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    ...(playwrightChannel ? { channel: playwrightChannel } : {}),
    ...(playwrightProxy ? {
      proxy: {
        bypass: '127.0.0.1,localhost',
        server: playwrightProxy,
      },
    } : {}),
  },
  webServer: {
    command: `VITE_E2E_AUTH_BYPASS=1 npm run build && npm run preview -- --host 127.0.0.1 --port ${playwrightPort}`,
    url: playwrightBaseUrl,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'Mobile 390x844',
      testIgnore: /desktop-beta-smoke\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'Desktop Beta Smoke 1440x900',
      testMatch: /desktop-beta-smoke\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
})

function resolvePort() {
  const explicitPort = Number.parseInt(
    process.env.PLAYWRIGHT_PORT?.trim() || process.env.E2E_PORT?.trim() || '',
    10,
  )
  if (Number.isInteger(explicitPort) && explicitPort > 0 && explicitPort <= 65535) {
    return explicitPort
  }

  return 4173
}

function resolveWorkerCount() {
  const explicitWorkers = Number.parseInt(
    process.env.PLAYWRIGHT_WORKERS?.trim() || process.env.E2E_WORKERS?.trim() || '',
    10,
  )
  if (Number.isInteger(explicitWorkers) && explicitWorkers > 0) {
    return explicitWorkers
  }

  if (process.env.CI) {
    return 2
  }

  return Math.min(4, Math.max(2, Math.floor(cpus().length / 2)))
}
