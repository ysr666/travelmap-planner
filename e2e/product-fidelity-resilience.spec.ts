import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  expectNoHorizontalOverflow,
  mockMapStyle,
  seedRouteCacheRecords,
  seedTravelObjectRuntimeContext,
  seedTravelRecords,
} from './helpers'
import {
  buildProductFidelityRouteCacheEntry,
  productFidelityFixture,
  productFidelityRecords as records,
  productFidelityTrip as trip,
  seedProductFidelity,
  seedProductFidelityData,
  trackUnexpectedProviderRequests,
} from './productFidelitySupport'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const viewports = [
  { height: 568, label: '320x568', width: 320 },
  { height: 844, label: '390x844', width: 390 },
  { height: 932, label: '430x932', width: 430 },
  { height: 1024, label: '768x1024', width: 768 },
  { height: 900, label: '1440x900', width: 1440 },
]

for (const viewport of viewports) {
  test(`五个产品构图在 ${viewport.label} 保持稳定且可操作`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockMapStyle(page)
    const providerRequests = trackUnexpectedProviderRequests(page)

    await seedProductFidelity(page, productFidelityFixture.scenarios.predeparture.fixedNow)
    await page.goto(productFidelityFixture.scenarios.predeparture.route, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('today-upcoming')).toBeVisible()
    await auditRichSurface(page, page.getByTestId('today-upcoming'), `${viewport.label} predeparture`)

    await page.clock.setSystemTime(new Date(productFidelityFixture.scenarios.activeToday.fixedNow))
    await seedProductFidelityData(page)
    await seedRouteCacheRecords(page, [buildProductFidelityRouteCacheEntry()])

    await page.goto(productFidelityFixture.scenarios.activeToday.route, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const hero = page.getByTestId('today-active-hero')
    await expect(hero).toBeVisible()
    await expect(hero.locator('[data-media-state="ready"]')).toBeVisible({ timeout: 15_000 })
    await auditRichSurface(page, hero, `${viewport.label} active Today`)

    await page.goto(productFidelityFixture.scenarios.itinerary.route, { waitUntil: 'domcontentloaded' })
    const timeline = page.getByTestId('day-timeline')
    await expect(timeline).toBeVisible()
    await expect(timeline.locator('[data-media-state="ready"]')).toHaveCount(4, { timeout: 15_000 })
    await auditRichSurface(page, timeline, `${viewport.label} itinerary`)

    await page.goto(productFidelityFixture.scenarios.documents.route, { waitUntil: 'domcontentloaded' })
    const gallery = page.getByTestId('ticket-gallery')
    await expect(gallery).toBeVisible()
    await expect(gallery.locator('[data-media-state="ready"]')).toHaveCount(4, { timeout: 15_000 })
    await auditRichSurface(page, gallery, `${viewport.label} documents`)

    await page.goto(itemDetailRoute(), { waitUntil: 'domcontentloaded' })
    const detail = page.getByTestId('item-detail-page')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.item-detail-media[data-media-state="ready"]')).toBeVisible({ timeout: 15_000 })
    await auditRichSurface(page, detail, `${viewport.label} item detail`)
    expect(providerRequests.count).toBe(0)
  })
}

test('深色构图没有严重无障碍问题且核心操作达到触控尺寸', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await mockMapStyle(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.activeToday.fixedNow)
  await seedRouteCacheRecords(page, [buildProductFidelityRouteCacheEntry()])
  await page.evaluate(() => window.localStorage.setItem('tripmap:appearance', 'dark'))

  const routes = [
    { root: '[data-testid="today-active-hero"]', route: productFidelityFixture.scenarios.activeToday.route },
    { root: '[data-testid="day-timeline"]', route: productFidelityFixture.scenarios.itinerary.route },
    { root: '[data-testid="ticket-gallery"]', route: productFidelityFixture.scenarios.documents.route },
    { root: '[data-testid="item-detail-page"]', route: itemDetailRoute() },
  ]
  for (const scenario of routes) {
    await page.goto(scenario.route, { waitUntil: 'domcontentloaded' })
    if (scenario.route === productFidelityFixture.scenarios.activeToday.route) {
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    await expect(page.locator(scenario.root)).toBeVisible()
    await waitForMediaToSettle(page)
    await expectNoHorizontalOverflow(page)
    await expectMinimumTouchTargets(page, scenario.root)
    await expectNoSeriousAxeViolations(page, scenario.root)
  }
})

test('长名称与 200% 文本在 320px 下仍保留操作', async ({ page }) => {
  await page.setViewportSize({ height: 568, width: 320 })
  await mockMapStyle(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.activeToday.fixedNow)
  const item = records.itineraryItems.find((candidate) => candidate.id === 'item_edinburgh_castle')!
  const ticket = records.ticketMetas.find((candidate) => candidate.id === 'ticket_edinburgh_castle')!
  await seedTravelRecords(page, {
    itineraryItems: [{
      ...item,
      address: 'ExtremelyLongUnbrokenAddressForResponsiveAcceptanceCastlehillEdinburghEH12NGUnitedKingdom',
      title: '爱丁堡城堡皇家历史建筑群特别展览与预约入场集合地点',
    }],
    ticketMetas: [{
      ...ticket,
      fileName: 'EdinburghCastleRoyalHistoricComplexAdmissionTicketWithoutAnySpaces-2026-08-18.pdf',
      title: '爱丁堡城堡皇家历史建筑群特别展览预约入场门票与家庭联票确认文件',
    }],
    trips: [],
  })
  await page.goto(productFidelityFixture.scenarios.activeToday.route, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.addStyleTag({
    content: 'html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }',
  })

  const title = page.getByTestId('today-active-hero').getByRole('heading')
  await expect(title).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: '开始导航' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(productFidelityFixture.scenarios.documents.route, { waitUntil: 'domcontentloaded' })
  const longTicket = page.getByTestId('ticket-card').filter({ hasText: '爱丁堡城堡皇家历史建筑群' })
  await expect(longTicket).toBeVisible()
  await expect(longTicket.locator('summary[aria-label$="更多操作"]')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(itemDetailRoute(), { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { exact: true, name: '开始导航' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '打开票据' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('媒体加载、失败、离线和省流状态不位移且不旁路 Provider', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await installLayoutShiftObserver(page)
  await mockMapStyle(page)
  let releaseImage: (() => void) | null = null
  const imageGate = new Promise<void>((resolve) => { releaseImage = resolve })
  await page.route('**/fixtures/product-fidelity/edinburgh-castle-hero.webp', async (route) => {
    const response = await route.fetch()
    await imageGate
    await route.fulfill({ response })
  })
  await seedProductFidelity(page, productFidelityFixture.scenarios.activeToday.fixedNow)
  await seedRouteCacheRecords(page, [buildProductFidelityRouteCacheEntry()])
  await page.goto(productFidelityFixture.scenarios.activeToday.route, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })

  const media = page.getByTestId('today-active-hero').locator('.today-active-hero-media')
  await expect(media).toHaveAttribute('data-media-state', 'loading')
  const loadingBox = await media.boundingBox()
  releaseImage?.()
  await expect(media).toHaveAttribute('data-media-state', 'ready', { timeout: 15_000 })
  const readyBox = await media.boundingBox()
  expectStableBox(loadingBox, readyBox)
  expect(await readLayoutShift(page)).toBeLessThan(0.1)

  await page.unroute('**/fixtures/product-fidelity/edinburgh-castle-hero.webp')
  await page.route('**/fixtures/product-fidelity/edinburgh-castle-hero.webp', (route) => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  const failedMedia = page.getByTestId('today-active-hero').locator('.today-active-hero-media')
  await expect(failedMedia).toHaveAttribute('data-media-state', 'error')
  await expect(failedMedia.getByTestId('media-fallback')).toBeVisible()
  expectStableBox(readyBox, await failedMedia.boundingBox())

  for (const policy of ['offline', 'reduced-data'] as const) {
    await page.unroute('**/fixtures/product-fidelity/edinburgh-castle-hero.webp')
    await installNetworkPolicy(page, policy)
    await seedProductFidelityData(page)
    await seedRouteCacheRecords(page, [buildProductFidelityRouteCacheEntry()])
    const providerRequests = trackUnexpectedProviderRequests(page)
    await seedTravelObjectRuntimeContext(page, {
      mediaAssets: [providerMediaAsset()],
      realtimeFacts: policy === 'offline' ? [] : records.realtimeFacts,
      tripId: trip.id,
    })
    await page.goto(productFidelityFixture.scenarios.activeToday.route, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const providerMedia = page.getByTestId('today-active-hero').locator('.today-active-hero-media')
    await expect(providerMedia).toHaveAttribute('data-media-state', policy)
    await expect(providerMedia.getByTestId('media-fallback')).toBeVisible()
    expect(providerRequests.count).toBe(0)
    await expectNoHorizontalOverflow(page)
  }
})

test('Reduced Motion 与软件键盘不会制造叠层或不可达操作', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMapStyle(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.documents.fixedNow)
  await page.goto(productFidelityFixture.scenarios.documents.route, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ticket-gallery')).toBeVisible()
  await expectReducedMotion(page, '.page-transition')

  await page.getByRole('button', { name: '搜索资料' }).click()
  const search = page.getByRole('textbox', { name: '搜索票据' })
  await expect(search).toBeVisible()
  await search.focus()
  await page.setViewportSize({ height: 520, width: 390 })
  await expect(search).toBeFocused()
  await expect(search).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'AI 助手' }).click()
  const dialog = page.getByRole('dialog', { name: 'AI 助手' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '全局 AI 指令' })).toBeInViewport()
  await expectReducedMotion(page, '.ai-action-sheet')
  await expectNoHorizontalOverflow(page)
})

async function auditRichSurface(page: Page, root: ReturnType<Page['locator']>, label: string) {
  await waitForMediaToSettle(page)
  await expectNoHorizontalOverflow(page)
  const box = await root.boundingBox()
  expect(box, `${label} should have measurable bounds`).not.toBeNull()
  expect(box!.width, `${label} should fit the viewport`).toBeLessThanOrEqual((await page.viewportSize())!.width + 1)
}

async function waitForMediaToSettle(page: Page) {
  await expect.poll(() => page.locator('[data-media-state="loading"]').count(), { timeout: 15_000 }).toBe(0)
}

async function expectMinimumTouchTargets(page: Page, selector: string) {
  const smallTargets = await page.locator(selector).evaluate((root) => {
    return Array.from(root.querySelectorAll('a, button, input, select, summary, textarea, [role="button"]'))
      .filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest('[data-mobile-target-exempt]')) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { height: Math.round(rect.height), label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40), width: Math.round(rect.width) }
      })
      .filter((target) => target.height < 44 || target.width < 44)
  })
  expect(smallTargets).toEqual([])
}

async function expectNoSeriousAxeViolations(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const serious = result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))
  expect(serious).toEqual([])
}

async function expectReducedMotion(page: Page, selector: string) {
  const durations = await page.locator(selector).evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      animation: Number.parseFloat(style.animationDuration) || 0,
      transition: Number.parseFloat(style.transitionDuration) || 0,
    }
  })
  expect(durations.animation).toBeLessThanOrEqual(0.001)
  expect(durations.transition).toBeLessThanOrEqual(0.001)
}

async function installLayoutShiftObserver(page: Page) {
  await page.addInitScript(() => {
    const state = window as Window & { __tripmapLayoutShift?: number }
    state.__tripmapLayoutShift = 0
    if (!('PerformanceObserver' in window)) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        if (!shift.hadRecentInput) state.__tripmapLayoutShift = (state.__tripmapLayoutShift ?? 0) + (shift.value ?? 0)
      }
    })
    try {
      observer.observe({ buffered: true, type: 'layout-shift' })
    } catch {
      // Older engines are still covered by the fixed-box assertion.
    }
  })
}

async function readLayoutShift(page: Page) {
  return await page.evaluate(() => (
    (window as Window & { __tripmapLayoutShift?: number }).__tripmapLayoutShift ?? 0
  ))
}

async function installNetworkPolicy(page: Page, policy: 'offline' | 'reduced-data') {
  await page.addInitScript((nextPolicy) => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => nextPolicy !== 'offline',
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: { saveData: nextPolicy === 'reduced-data' },
    })
  }, policy)
}

function expectStableBox(
  before: { height: number; width: number } | null,
  after: { height: number; width: number } | null,
) {
  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(Math.abs(before!.height - after!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(before!.width - after!.width)).toBeLessThanOrEqual(1)
}

function providerMediaAsset() {
  const photoRef = 'places/ChIJ-test/photos/A1234567890abcdef'
  return {
    aspectRatio: 1.5,
    attribution: [{ label: 'Google', uri: 'https://www.google.com/maps' }],
    expiresAt: '2027-08-18T00:00:00.000Z',
    height: 1200,
    id: 'media_edinburgh_castle_provider_v1',
    kind: 'place_photo',
    observedAt: '2026-08-18T00:00:00.000Z',
    providerRef: photoRef,
    renderRef: { photoRef, provider: 'google_places', type: 'provider_photo' },
    schemaVersion: 1,
    source: 'google_places',
    sourceUri: 'https://www.google.com/maps',
    subjectId: 'item_edinburgh_castle',
    subjectType: 'item',
    tripId: trip.id,
    width: 1800,
  }
}

function itemDetailRoute() {
  return `/#/item?tripId=${trip.id}&dayId=day_uk_07&itemId=item_edinburgh_castle&view=schedule`
}
