import { defineConfig } from '@playwright/test'

const playwrightProxy = process.env.PLAYWRIGHT_PROXY?.trim()
const playwrightChannel = process.env.PLAYWRIGHT_CHANNEL?.trim()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
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
      },
    },
  ],
})
