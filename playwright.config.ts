import { defineConfig } from '@playwright/test'
import { cpus } from 'node:os'

const playwrightProxy = process.env.PLAYWRIGHT_PROXY?.trim()
const playwrightChannel = process.env.PLAYWRIGHT_CHANNEL?.trim()
const playwrightWorkers = resolveWorkerCount()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: playwrightWorkers,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'Mobile 390x844',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        timezoneId: 'Asia/Shanghai',
      },
    },
  ],
})

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
