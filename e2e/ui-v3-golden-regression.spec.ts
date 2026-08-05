import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import homePredepartureFixture from './fixtures/home-predeparture-v3-visual.json' with { type: 'json' }
import { clearTravelDatabase, seedTravelRecords } from './helpers'
import {
  buildUiV3GoldenBaseline,
  startUiV3GoldenServer,
  UI_V3_GOLDEN_BASELINE,
  type UiV3GoldenServer,
} from './uiV3GoldenBaseline'

test.use({ locale: 'zh-CN', timezoneId: 'Europe/London' })
test.describe.configure({ mode: 'serial' })

const viewport = { height: 844, width: 390 }
const maxDiffPixelRatio = 0.005

test('UI V3 core static pages stay within the approved golden pixel budget', async ({ context, page }, testInfo) => {
  test.setTimeout(180_000)
  const tempDir = await mkdtemp(join(tmpdir(), 'tripmap-ui-v3-golden-'))
  let goldenServer: UiV3GoldenServer | null = null
  const baselinePage = await context.newPage()

  try {
    const distDir = await buildUiV3GoldenBaseline(tempDir)
    goldenServer = await startUiV3GoldenServer(distDir)
    await Promise.all([
      prepareGoldenPage(page, ''),
      prepareGoldenPage(baselinePage, goldenServer.origin),
    ])

    const trip = homePredepartureFixture.records.trips[0]
    const day = homePredepartureFixture.records.days[0]
    const item = homePredepartureFixture.records.itineraryItems[0]
    const scenarios = [
      {
        href: '/#/home',
        name: 'predeparture-home',
        readySelector: '[data-testid="today-upcoming"]',
      },
      {
        href: `/#/trip?tripId=${trip.id}`,
        name: 'trip-overview',
        readySelector: '[data-testid="trip-home-focus-timeline"]',
      },
      {
        href: `/#/documents?tripId=${trip.id}&tab=attachments`,
        name: 'documents',
        readySelector: '[data-testid="ticket-card"]',
      },
      {
        href: `/#/item?tripId=${trip.id}&dayId=${day.id}&itemId=${item.id}&view=schedule`,
        name: 'place-detail',
        readySelector: '[data-testid="item-detail-page"]',
      },
    ]

    for (const scenario of scenarios) {
      const [currentScreenshot, baselineScreenshot] = await Promise.all([
        captureScenario(page, scenario.href, scenario.readySelector),
        captureScenario(
          baselinePage,
          new URL(scenario.href, goldenServer.origin).toString(),
          scenario.readySelector,
        ),
      ])
      const diffRatio = await calculatePixelDiffRatio(page, currentScreenshot, baselineScreenshot)
      if (diffRatio > maxDiffPixelRatio) {
        await attachFailureScreenshots(testInfo, scenario.name, currentScreenshot, baselineScreenshot)
      }
      expect(
        diffRatio,
        `${scenario.name} differs from approved UI V3 baseline ${UI_V3_GOLDEN_BASELINE.commit.slice(0, 8)}`,
      ).toBeLessThanOrEqual(maxDiffPixelRatio)
    }
  } finally {
    await baselinePage.close()
    if (goldenServer) await goldenServer.close()
    await rm(tempDir, { force: true, recursive: true })
  }
})

async function prepareGoldenPage(page: Page, appOrigin: string) {
  await page.setViewportSize(viewport)
  await page.clock.setFixedTime(new Date(homePredepartureFixture.fixedNow))
  await clearTravelDatabase(page, appOrigin)
  await seedTravelRecords(page, homePredepartureFixture.records)
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:appearance', 'light')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function captureScenario(page: Page, href: string, readySelector: string) {
  await page.goto(href, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(readySelector).first()).toBeVisible({ timeout: 15_000 })
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-duration: 0s !important;
      }
    `,
  })
  await page.evaluate(async () => {
    await document.fonts.ready
    window.scrollTo(0, 0)
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
  })
  return page.screenshot({ animations: 'disabled', caret: 'hide' })
}

async function calculatePixelDiffRatio(page: Page, current: Buffer, baseline: Buffer) {
  return page.evaluate(async ({ baselineBase64, currentBase64 }) => {
    async function decode(base64: string) {
      const response = await fetch(`data:image/png;base64,${base64}`)
      return createImageBitmap(await response.blob())
    }

    const [currentImage, baselineImage] = await Promise.all([
      decode(currentBase64),
      decode(baselineBase64),
    ])
    if (currentImage.width !== baselineImage.width || currentImage.height !== baselineImage.height) {
      currentImage.close()
      baselineImage.close()
      return 1
    }

    const canvas = document.createElement('canvas')
    canvas.width = currentImage.width
    canvas.height = currentImage.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas 2D is unavailable for UI V3 golden comparison')
    context.drawImage(currentImage, 0, 0)
    const currentPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(baselineImage, 0, 0)
    const baselinePixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    currentImage.close()
    baselineImage.close()

    let differingPixels = 0
    for (let index = 0; index < currentPixels.length; index += 4) {
      const maximumChannelDelta = Math.max(
        Math.abs(currentPixels[index] - baselinePixels[index]),
        Math.abs(currentPixels[index + 1] - baselinePixels[index + 1]),
        Math.abs(currentPixels[index + 2] - baselinePixels[index + 2]),
        Math.abs(currentPixels[index + 3] - baselinePixels[index + 3]),
      )
      if (maximumChannelDelta > 16) differingPixels += 1
    }
    return differingPixels / (canvas.width * canvas.height)
  }, {
    baselineBase64: baseline.toString('base64'),
    currentBase64: current.toString('base64'),
  })
}

async function attachFailureScreenshots(
  testInfo: TestInfo,
  name: string,
  current: Buffer,
  baseline: Buffer,
) {
  await Promise.all([
    testInfo.attach(`${name}-current`, { body: current, contentType: 'image/png' }),
    testInfo.attach(`${name}-baseline`, { body: baseline, contentType: 'image/png' }),
  ])
}
