import { expect, test, type Page } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, getFirstTripDayAndItemIds } from './helpers'

test('首页可以手动创建示例旅行并进入旅行工作台', async ({ page }) => {
  await setActiveDemoDate(page)
  await clearTravelDatabase(page)

  const banner = page.getByRole('banner')
  await expect(banner.getByRole('heading', { name: '今日' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '开始准备下一次旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  await expect(page.getByRole('button', { name: '当前旅行：东京春日旅行' })).toBeVisible()
  await expect(page.locator('.maplibregl-map')).toHaveCount(1)
  await page.getByRole('button', { name: '行程', exact: true }).click()

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: '行程', exact: true })).toBeVisible()
  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()
  const { dayId } = await getFirstTripDayAndItemIds(page, tripId!)
  await page.goto(`/#/day?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByTestId('view-switch-schedule')).toHaveCount(0)
  await expect(page.getByTestId('view-switch-map')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  const dayMoreMenu = page.getByTestId('day-more-menu')
  await expect(dayMoreMenu).toBeVisible()
  await expect(dayMoreMenu.getByRole('button', { name: '票据库' })).toBeVisible()
  await dayMoreMenu.getByRole('button', { name: '旅行总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: '行程', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('首页旅行中视图固定显示下一站操作并把地图放在其后', async ({ page }) => {
  await setActiveDemoDate(page)
  await clearTravelDatabase(page)
  await page.getByRole('button', { name: '创建示例旅行' }).click()

  const sheet = page.getByTestId('today-trip-sheet')
  const map = page.locator('.today-map-stage')
  await expect(sheet).toBeVisible()
  await expect(map).toBeVisible()
  await expect(page.getByTestId('today-sheet-handle')).toHaveCount(0)
  await expect(sheet.getByText('下一站')).toBeVisible()
  await expect(sheet.getByRole('link', { name: '开始导航' })).toBeVisible()
  const sheetBox = await sheet.boundingBox()
  const mapBox = await map.boundingBox()
  expect(sheetBox).not.toBeNull()
  expect(mapBox).not.toBeNull()
  expect(sheetBox!.y).toBeLessThan(mapBox!.y)
  await expectNoHorizontalOverflow(page)
})

test('首页只展开一个底部交互面并支持 200% 文字放大', async ({ page }) => {
  await setActiveDemoDate(page)
  await clearTravelDatabase(page)
  await page.getByRole('button', { name: '创建示例旅行' }).click()

  const sheet = page.getByTestId('today-trip-sheet')
  const stopTitle = sheet.locator('.today-next-stop h2')
  const initialFontSize = await stopTitle.evaluate((element) => (
    Number.parseFloat(window.getComputedStyle(element).fontSize)
  ))

  await page.addStyleTag({
    content: 'html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }',
  })

  await expect.poll(async () => stopTitle.evaluate((element) => (
    Number.parseFloat(window.getComputedStyle(element).fontSize)
  ))).toBeGreaterThanOrEqual(initialFontSize * 1.8)
  await expect(page.getByTestId('today-sheet-handle')).toHaveCount(0)
  await expect(sheet.getByRole('link', { name: '开始导航' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'AI 助手' }).click()
  await page.setViewportSize({ height: 520, width: 390 })
  await expect(page.getByRole('dialog', { name: 'AI 助手' })).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('textbox', { name: '全局 AI 指令' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '关闭 AI 助手' }).click()
  await expect(sheet).toBeVisible()
})

test('首页和 AI Action Sheet 在 Reduced Motion 下停用可见动效', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setActiveDemoDate(page)
  await clearTravelDatabase(page)
  await page.getByRole('button', { name: '创建示例旅行' }).click()

  await expect(page.getByTestId('today-trip-sheet')).toBeVisible()
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await expectReducedMotionDurations(page, '.page-transition')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'AI 助手' }).click()
  await expect(page.getByRole('dialog', { name: 'AI 助手' })).toBeVisible()
  await expectReducedMotionDurations(page, '.ai-action-sheet')
  await expect.poll(() => page.evaluate(() => (
    document.getAnimations().filter((animation) => {
      const duration = Number(animation.effect?.getTiming().duration ?? 0)
      return animation.playState === 'running' && Number.isFinite(duration) && duration > 1
    }).length
  ))).toBe(0)
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '关闭 AI 助手' }).click()
  await expect(page.getByTestId('today-trip-sheet')).toBeVisible()
})

test('首页长内容在规定的移动端、平板和桌面尺寸下不溢出', async ({ page }) => {
  await setActiveDemoDate(page)
  await clearTravelDatabase(page)
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  await expect(page.getByRole('button', { name: '当前旅行：东京春日旅行' })).toBeVisible()
  await page.getByRole('button', { name: '行程', exact: true }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)

  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()
  const { firstItemId } = await getFirstTripDayAndItemIds(page, tripId!)
  await updateHomeLongContent(page, tripId!, firstItemId)
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })

  for (const viewport of [
    { height: 568, width: 320 },
    { height: 844, width: 390 },
    { height: 932, width: 430 },
    { height: 1024, width: 768 },
    { height: 900, width: 1440 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.getByText('一段足够长且必须自然换行的旅行目的地名称')).toBeVisible()
    await expect(page.getByTestId('today-trip-sheet')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }
})

async function setActiveDemoDate(page: Page) {
  await page.clock.setFixedTime(new Date('2026-04-14T10:00:00.000+09:00'))
}

async function expectReducedMotionDurations(page: Page, selector: string) {
  const durations = await page.locator(selector).evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    }
  })

  expect(parseCssDurationMs(durations.animationDuration)).toBeLessThanOrEqual(0.02)
  expect(parseCssDurationMs(durations.transitionDuration)).toBeLessThanOrEqual(0.02)
}

function parseCssDurationMs(value: string) {
  return Math.max(...value.split(',').map((part) => {
    const normalized = part.trim()
    if (normalized.endsWith('ms')) return Number.parseFloat(normalized)
    if (normalized.endsWith('s')) return Number.parseFloat(normalized) * 1000
    return 0
  }))
}

async function updateHomeLongContent(page: Page, tripId: string, itemId: string) {
  await page.evaluate(async ({ targetItemId, targetTripId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    const transaction = db.transaction(['trips', 'itineraryItems'], 'readwrite')
    const tripStore = transaction.objectStore('trips')
    const itemStore = transaction.objectStore('itineraryItems')
    const trip = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = tripStore.get(targetTripId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('读取旅行失败'))
    })
    const item = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = itemStore.get(targetItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('读取行程点失败'))
    })
    tripStore.put({
      ...trip,
      destination: '一段足够长且必须自然换行的旅行目的地名称',
      title: '一段足够长且必须自然换行的旅行名称',
      updatedAt: Date.now(),
    })
    itemStore.put({
      ...item,
      locationName: '一段非常长的地点补充信息，用于验证窄屏与放大字号下不会横向溢出',
      title: '这是一个很长的行程点名称，用来验证首页抽屉的换行与布局稳定性',
      updatedAt: Date.now(),
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('更新测试数据失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('更新测试数据中断'))
    })
    db.close()
  }, { targetItemId: itemId, targetTripId: tripId })
}
