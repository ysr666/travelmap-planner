import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearTravelDatabase, forceSupabaseFixture, seedTravelRecords } from './helpers'

test('Companion shared trip supports read, comment, activity, and collaborator sync', async ({ page }) => {
  const seed = createSharedTripSeed()
  await clearTravelDatabase(page)
  await forceSupabaseFixture(page, { user: { email: 'owner@example.com', id: 'owner_1' } })
  await seedTravelRecords(page, seed)

  await page.goto(`/#/trip?tripId=${seed.trips[0].id}`, { waitUntil: 'domcontentloaded' })
  await openTripHomeSecondaryTools(page)
  const panel = page.getByTestId('shared-trip-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '开启同行共享' }).click()
  await expect(panel).toContainText('已开启')

  await selectInvitePermission(panel, 'read')
  await panel.getByRole('button', { name: '生成链接' }).click()
  const readInviteUrl = await readLatestInviteUrl(panel)

  await selectInvitePermission(panel, 'comment')
  await panel.getByRole('button', { name: '生成链接' }).click()
  const commentInviteUrl = await readLatestInviteUrl(panel, readInviteUrl)

  await selectInvitePermission(panel, 'collaborate')
  await panel.getByRole('button', { name: '生成链接' }).click()
  const collaborateInviteUrl = await readLatestInviteUrl(panel, commentInviteUrl)

  await switchFixtureUser(page, 'reader_1', 'reader@example.com')
  await page.goto(readInviteUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('shared-trip-page')).toBeVisible()
  await expect(page.getByTestId('shared-trip-page')).toContainText('只读')
  await expect(page.getByRole('button', { name: '发送' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '协作修改' })).toHaveCount(0)

  await switchFixtureUser(page, 'commenter_1', 'commenter@example.com')
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await page.goto(commentInviteUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('shared-trip-page')).toContainText('可评论')
  await page.getByRole('button', { name: '我已到集合点' }).first().click()
  await expect(page.getByTestId('shared-trip-item').first()).toContainText('我已到集合点')
  await expect(page.getByRole('button', { name: '协作修改' })).toHaveCount(0)

  await switchFixtureUser(page, 'collab_1', 'collab@example.com')
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await page.goto(collaborateInviteUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('shared-trip-page')).toContainText('可协作')
  await page.getByRole('button', { name: '协作修改' }).first().click()
  const firstItem = page.getByTestId('shared-trip-item').first()
  await firstItem.getByTestId('shared-trip-edit-title').fill('协作修改后的集合点')
  await firstItem.getByRole('button', { name: '提交修改' }).click()

  await switchFixtureUser(page, 'owner_1', 'owner@example.com')
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await page.goto(`/#/trip?tripId=${seed.trips[0].id}`, { waitUntil: 'domcontentloaded' })
  await openTripHomeSecondaryTools(page)
  await expect(panel).toContainText('我已到集合点')
  await panel.getByRole('button', { name: /同步同行更改/ }).click()
  await expect(panel).toContainText('应用 1 项')

  const localTitle = await page.evaluate(async (itemId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return await new Promise<string | undefined>((resolve, reject) => {
      const transaction = db.transaction('itineraryItems', 'readonly')
      const getRequest = transaction.objectStore('itineraryItems').get(itemId)
      getRequest.onsuccess = () => resolve(getRequest.result?.title)
      getRequest.onerror = () => reject(getRequest.error)
    })
  }, seed.itineraryItems[0].id)
  expect(localTitle).toBe('协作修改后的集合点')
})

test('Package 6 同行冲突建议脱敏且不会自动执行', async ({ page }) => {
  const seed = createSharedTripSeed()
  await clearTravelDatabase(page)
  await forceSupabaseFixture(page, { user: { email: 'owner@example.com', id: 'owner_1' } })
  await seedTravelRecords(page, seed)
  await page.goto(`/#/trip?tripId=${seed.trips[0].id}`, { waitUntil: 'domcontentloaded' })
  await openTripHomeSecondaryTools(page)
  const panel = page.getByTestId('shared-trip-panel')
  await panel.getByRole('button', { name: '开启同行共享' }).click()
  await expect(panel).toContainText('已开启')

  await page.evaluate((itemId) => {
    const fixture = JSON.parse(window.localStorage.getItem('tripmap:e2e:cloud-fixture') ?? '{}')
    const sharedTrip = fixture.sharedTripRows?.[0]
    if (!sharedTrip) throw new Error('共享旅行 fixture 未创建')
    const now = new Date().toISOString()
    fixture.sharedMutationRows = [{
      createdAt: now,
      id: 'mutation-conflict-redacted',
      mutationType: 'update_item',
      payload: {
        baselineUpdatedAt: 1,
        itemId,
        patch: {
          notes: 'SECRET-COMPANION-NOTE-112233',
          title: '绝不能自动写入的同行标题',
        },
      },
      rejectedReason: 'SECRET-REJECTED-REASON-445566',
      sharedTripId: sharedTrip.id,
      status: 'conflict',
      updatedAt: now,
      userId: 'collaborator_1',
    }]
    window.localStorage.setItem('tripmap:e2e:cloud-fixture', JSON.stringify(fixture))
  }, seed.itineraryItems[0].id)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await openTripHomeSecondaryTools(page)
  const intelligence = page.getByTestId('shared-trip-intelligence-panel')
  await expect(intelligence).toContainText('同行更改存在冲突')
  await expect(intelligence).not.toContainText('SECRET-COMPANION-NOTE-112233')
  await expect(intelligence).not.toContainText('SECRET-REJECTED-REASON-445566')
  await expect(intelligence.getByRole('button', { name: /稍后处理/ })).toBeVisible()
  await expect(intelligence.getByRole('button', { name: /忽略建议/ })).toHaveCount(0)

  await intelligence.getByTestId('shared-trip-intelligence-action').click()
  const titleAfterSuggestionClick = await readItemTitle(page, seed.itineraryItems[0].id)
  expect(titleAfterSuggestionClick).toBe('涩谷集合')
  await expect(panel.getByRole('button', { name: /同步同行更改/ })).toBeVisible()
})

async function openTripHomeSecondaryTools(page: Page) {
  const tools = page.getByTestId('trip-home-secondary-tools')
  if (await tools.isVisible().catch(() => false)) return
  await page.locator('summary').filter({ hasText: '更多工具与详情' }).click()
  await expect(tools).toBeVisible()
}

async function readLatestInviteUrl(panel: Locator, previous = '') {
  await expect.poll(async () => readLatestInviteUrlText(panel)).not.toBe(previous)
  const latest = await readLatestInviteUrlText(panel)
  expect(latest).toBeTruthy()
  return latest
}

async function selectInvitePermission(panel: Locator, permission: 'read' | 'comment' | 'collaborate') {
  const select = panel.getByLabel('新链接权限')
  await select.selectOption(permission)
  await expect(select).toHaveValue(permission)
}

async function readLatestInviteUrlText(panel: Locator) {
  const urls = await panel.locator('p').evaluateAll((nodes) =>
    nodes
      .map((node) => node.textContent ?? '')
      .filter((text) => text.includes('/#/shared-trip?invite=')),
  )
  return urls.at(-1) ?? ''
}

async function switchFixtureUser(page: Page, id: string, email: string) {
  await page.evaluate(({ email: nextEmail, id: nextId }) => {
    const current = JSON.parse(window.localStorage.getItem('tripmap:e2e:cloud-fixture') ?? '{}')
    window.localStorage.setItem('tripmap:e2e:cloud-fixture', JSON.stringify({
      ...current,
      user: { email: nextEmail, id: nextId },
    }))
  }, { email, id })
}

async function readItemTitle(page: Page, itemId: string) {
  return page.evaluate(async (targetItemId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('itineraryItems', 'readonly')
    const getRequest = transaction.objectStore('itineraryItems').get(targetItemId)
    const title = await new Promise<string | undefined>((resolve, reject) => {
      getRequest.onsuccess = () => resolve(getRequest.result?.title)
      getRequest.onerror = () => reject(getRequest.error)
    })
    db.close()
    return title
  }, itemId)
}

function createSharedTripSeed() {
  const now = Date.now()
  const trip = {
    createdAt: now,
    destination: '日本东京',
    endDate: '2026-04-03',
    id: 'trip_shared_e2e',
    startDate: '2026-04-01',
    title: '东京共享旅行',
    updatedAt: now,
  }
  const day = {
    date: '2026-04-01',
    id: 'day_shared_e2e',
    sortOrder: 1,
    title: '第一天',
    tripId: trip.id,
  }
  const item = {
    createdAt: now,
    dayId: day.id,
    id: 'item_shared_e2e',
    locationName: '涩谷站',
    sortOrder: 1,
    startTime: '09:30',
    ticketIds: ['ticket_shared_e2e'],
    title: '涩谷集合',
    tripId: trip.id,
    updatedAt: now,
  }
  const ticket = {
    createdAt: now,
    fileName: 'secret-ticket.pdf',
    fileType: 'pdf',
    id: 'ticket_shared_e2e',
    itemId: item.id,
    mimeType: 'application/pdf',
    scope: 'item',
    size: 123,
    storageMode: 'copy',
    ticketCategory: 'transport_booking',
    title: '集合交通票',
    tripId: trip.id,
    updatedAt: now,
  }

  return {
    days: [day],
    itineraryItems: [item],
    ticketMetas: [ticket],
    trips: [trip],
  }
}
