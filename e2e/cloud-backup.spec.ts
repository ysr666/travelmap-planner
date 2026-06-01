import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseFixture,
  forceSupabaseUnconfigured,
  seedTravelRecords,
} from './helpers'

test('设置页 Supabase 未配置时显示云端保存提示且不显示登录上传控件', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')

  await expect(cloudSection).toBeVisible()
  const message = page.getByTestId('supabase-unconfigured-message')
  await expect(message).toContainText('云端保存未配置')
  await expect(message).toContainText('VITE_SUPABASE_URL')
  await expect(message).toContainText('VITE_SUPABASE_ANON_KEY')
  await expect(cloudSection).toContainText('真实上传/恢复前')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('云端自动同步')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('配置 Supabase 后才能开启。')
  await expect(page.getByTestId('auto-cloud-backup-toggle')).toBeDisabled()
  await expect(page.getByTestId('cloud-login-form')).toHaveCount(0)
  await expect(page.getByTestId('cloud-upload-current-trip')).toHaveCount(0)
  await expect(page.getByTestId('cloud-backup-list')).toHaveCount(0)
  await expect(page.getByTestId('cloud-snapshot-check-prompts')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('设置页通过 section=cloud 可以直接打开云端保存区域', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  await expect(cloudSection).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Day View 不显示云端保存检查提醒', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await createDemoTripViaUi(page)
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expect(page.getByTestId('trip-home-cloud-save-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('本地新建和编辑旅行不受云端保存提醒干扰', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: '新建旅行' }).click()
  await expect(page.getByTestId('trip-form-page')).toBeVisible()

  await page.getByLabel('旅行标题').fill('测试旅行')
  await page.getByLabel('开始日期').fill('2026-06-01')
  await page.getByLabel('结束日期').fill('2026-06-02')
  await page.getByTestId('trip-form-submit').click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)

  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expect(page.getByTestId('trip-home-cloud-save-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 本地和云端同时变更时按最新版本无感自动同步', async ({ page }) => {
  await clearTravelDatabase(page)
  const trip = createSeedTrip({
    id: 'trip_auto_conflict',
    title: '自动同步本地较新版本',
    updatedAt: Date.parse('2026-04-02T13:00:00.000Z'),
  })
  await seedTravelRecords(page, {
    days: [createSeedDay(trip.id)],
    trips: [trip],
  })
  await forceSupabaseFixture(page, {
    backups: [
      createCloudBackup({
        exportedAt: '2026-04-02T12:00:00.000Z',
        id: 'backup_cloud_newer',
        originalTripId: trip.id,
        title: '自动同步云端旧版本',
      }),
    ],
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await page.evaluate((tripId) => {
    window.localStorage.setItem(
      'tripmap:cloud-auto-snapshot:state',
      JSON.stringify({
        trips: {
          [tripId]: {
            dirtyAt: Date.parse('2026-04-02T13:00:00.000Z'),
            lastSuccessAt: Date.parse('2026-04-02T10:30:00.000Z'),
            status: 'dirty',
            tripId,
          },
        },
        version: 1,
      }),
    )
  }, trip.id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto(`/#/trip?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('trip-home-cloud-save-card')).toHaveCount(0)
  await expect(page.getByTestId('cloud-save-confirm-dialog')).toHaveCount(0)
  await expect.poll(async () => readCloudFixtureBackupTitle(page, trip.id)).toBe(trip.title)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 本地版本较新且无冲突时会自动更新云端保存', async ({ page }) => {
  await clearTravelDatabase(page)
  const trip = createSeedTrip({ id: 'trip_local_newer', updatedAt: Date.parse('2026-04-02T14:00:00.000Z') })
  await seedTravelRecords(page, {
    days: [createSeedDay(trip.id)],
    trips: [trip],
  })
  await forceSupabaseFixture(page, {
    backups: [
      createCloudBackup({
        exportedAt: '2026-04-02T12:00:00.000Z',
        id: 'backup_local_older',
        originalTripId: trip.id,
      }),
    ],
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto(`/#/trip?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('trip-home-cloud-save-card')).toHaveCount(0)
  await expect.poll(async () => readCloudFixtureBackupTitle(page, trip.id)).toBe(trip.title)
  await expectNoHorizontalOverflow(page)
})

test('登录后打开 PWA 会自动拉取仅存在云端的旅行', async ({ page }) => {
  await clearTravelDatabase(page)
  const trip = createSeedTrip({
    id: 'trip_cloud_only',
    title: '云端自动同步旅行',
    updatedAt: Date.parse('2026-04-05T09:00:00.000Z'),
  })
  const day = createSeedDay(trip.id, 'day_cloud_only')
  const backup = createCloudBackup({
    exportedAt: '2026-04-05T09:30:00.000Z',
    id: 'backup_cloud_only',
    originalTripId: trip.id,
    snapshotPath: 'user_1/backup_cloud_only/snapshot.json',
    title: trip.title,
  })
  await forceSupabaseFixture(page, {
    backups: [backup],
    snapshots: {
      [backup.id]: createCloudSnapshot({
        days: [day],
        exportedAt: backup.exportedAt,
        trip,
      }),
    },
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('trip-card').filter({ hasText: trip.title })).toBeVisible()
  await expect.poll(async () => (await readLocalTripState(page, trip.id)).title).toBe(trip.title)
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await expectNoHorizontalOverflow(page)
})

test('云端恢复确认会原地覆盖本地旅行并在刷新后保留云端版本', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:cloud-auto-snapshot:enabled', '0')
  })
  await forceSupabaseFixture(page, {
    backups: [],
    user: { email: 'qa@example.com', id: 'user_restore_e2e' },
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await attachTinyImageTicket(page, tripId)

  const titleV1 = '云端恢复 QA V1'
  const titleV2 = '云端恢复 QA V2'
  const titleV3 = '云端恢复 QA V3 本地修改'
  await updateLocalTripVersion(page, tripId, titleV1, '云端恢复票据 V1')
  await expectUploadCurrentTrip(page, tripId, titleV1)
  await updateLocalTripVersion(page, tripId, titleV2, '云端恢复票据 V2')
  await expectUploadCurrentTrip(page, tripId, titleV2)
  await expect(page.getByTestId('cloud-backup-group').filter({ hasText: '云端恢复 QA' })).toHaveCount(1)

  await updateLocalTripVersion(page, tripId, titleV3, '云端恢复票据 V3')
  await expectLocalTripTitle(page, tripId, titleV3)
  await restoreCloudBackupFromPanel(page, tripId, titleV2, false)
  await expectLocalTripTitle(page, tripId, titleV3)

  await restoreCloudBackupFromPanel(page, tripId, titleV2, true)
  await expectLocalTripTitle(page, tripId, titleV2)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expectLocalTripTitle(page, tripId, titleV2)

  const restoredState = await readLocalTripState(page, tripId)
  expect(restoredState.tripCount).toBe(1)
  expect(restoredState.ticketTitle).toBe('Cloud restore tiny ticket')
  expect(restoredState.ticketBlobSize).toBe(68)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  const ticketCard = page.getByTestId('ticket-card').filter({ hasText: 'Cloud restore tiny ticket' }).first()
  await expect(ticketCard).toBeVisible()
  await ticketCard.getByRole('button', { name: /查看/ }).first().click()
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
  await expect(page.getByTestId('ticket-preview-image')).toBeVisible()
})

test('设置页云端列表展示历史遗留的同一旅行多条云端保存', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await clearTravelDatabase(page)
  await forceSupabaseFixture(page, {
    backups: [
      createCloudBackup({
        exportedAt: '2026-04-02T10:00:00.000Z',
        filesCount: 1,
        id: 'backup_older',
        originalTripId: 'trip_grouped',
      }),
      createCloudBackup({
        exportedAt: '2026-04-03T10:00:00.000Z',
        filesCount: 2,
        id: 'backup_newer',
        originalTripId: 'trip_grouped',
      }),
    ],
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await page.evaluate(() => window.localStorage.setItem('tripmap:appearance', 'dark'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('html')).toHaveClass(/dark/)
  const list = page.getByTestId('cloud-backup-list')
  await expect(list).toContainText('历史备份（旧版本）')
  await expect(list).toContainText('2 条历史备份')
  await expect(list).toContainText('旧版本可能留下多条云端保存')
  await expect(list).toContainText('不会自动清理')
  await expect(list).toContainText('云端保存')
  await expect(list).toContainText('云端版本时间')
  await expect(list).toContainText('附件数量')
  const newestBackupCard = list.getByTestId('cloud-backup-card').filter({ hasText: '旧版备份 2' })
  await expect(newestBackupCard.getByTestId('cloud-restore-backup')).toContainText('用云端覆盖本地')
  await newestBackupCard.getByTestId('cloud-restore-backup').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('用云端覆盖本地？')
  await expect(dialog).toContainText('不会创建新的本地旅行副本。')
  await expect(dialog).toContainText('云端版本时间')
  await expectNoHorizontalOverflow(page)
})

test('设置页只显示通用路线服务状态和缓存管理', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('routing-settings-section')).toBeVisible()
  await expect(page.getByTestId('routing-settings-section')).toContainText(/路线服务由旅图提供|路线服务暂不可用/)
  await expect(page.getByTestId('routing-api-key-input')).toHaveCount(0)
  await expect(page.getByTestId('routing-api-key-save')).toHaveCount(0)
  await expect(page.getByTestId('routing-api-key-clear')).toHaveCount(0)
  await expect(page.getByTestId('google-maps-key-input')).toHaveCount(0)
  await expect(page.getByTestId('route-cache-stats')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

function createSeedTrip(patch: Record<string, unknown> = {}) {
  return {
    createdAt: Date.parse('2026-04-02T10:00:00.000Z'),
    destination: '日本东京',
    endDate: '2026-04-04',
    id: 'trip_1',
    startDate: '2026-04-01',
    title: '东京春日旅行',
    updatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
    ...patch,
  }
}

function createSeedDay(tripId: string, id = 'day_1') {
  return {
    date: '2026-04-01',
    id,
    sortOrder: 1,
    title: '第一天',
    tripId,
  }
}

function createCloudBackup(patch: Record<string, unknown> = {}) {
  return {
    appVersion: '0.3.0.2',
    createdAt: '2026-04-02T09:00:00.000Z',
    destination: '日本东京',
    exportedAt: '2026-04-02T09:00:00.000Z',
    filesCount: 0,
    id: 'backup_1',
    originalTripId: 'trip_1',
    schemaVersion: 1,
    snapshotPath: 'user_1/backup_1/snapshot.json',
    title: '东京春日旅行',
    totalSizeBytes: 0,
    updatedAt: '2026-04-02T09:00:00.000Z',
    userId: 'user_1',
    warnings: [],
    ...patch,
  }
}

function createCloudSnapshot({
  days,
  exportedAt,
  trip,
}: {
  days: ReturnType<typeof createSeedDay>[]
  exportedAt: string
  trip: ReturnType<typeof createSeedTrip>
}) {
  return {
    appName: '旅图',
    appVersion: '0.3.0.2',
    days,
    exportedAt,
    fileRefs: [],
    itineraryItems: [],
    originalTripId: trip.id,
    schemaVersion: 1,
    ticketMetas: [],
    trip,
    type: 'cloud-trip-backup',
    warnings: [],
  }
}

async function openCloudBackupPanel(page: Page, tripId: string) {
  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const details = page.locator('details').filter({ hasText: '备份与恢复' }).first()
  await details.evaluate((element) => {
    element.open = true
  })
  await expect(page.getByTestId('cloud-backup-section')).toBeVisible()
}

async function expectUploadCurrentTrip(page: Page, tripId: string, expectedTitle: string) {
  await openCloudBackupPanel(page, tripId)
  await page.getByTestId('cloud-upload-current-trip').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('云端原有版本会被覆盖')
  await expect(dialog).toContainText('不会创建新的云端快照列表')
  await expect(dialog).toContainText('不会自动合并')
  await dialog.getByRole('button', { name: '更新云端保存' }).click()
  await expect(page.locator('body')).toContainText('云端保存已覆盖更新')
  await expect(page.getByTestId('cloud-backup-group').filter({ hasText: expectedTitle })).toBeVisible()
}

async function restoreCloudBackupFromPanel(
  page: Page,
  tripId: string,
  expectedCloudTitle: string,
  confirm: boolean,
) {
  await openCloudBackupPanel(page, tripId)
  const group = page.getByTestId('cloud-backup-group').filter({ hasText: expectedCloudTitle }).first()
  await expect(group).toBeVisible()
  await group.getByTestId('cloud-restore-backup').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('将用云端版本覆盖当前本地旅行')
  await expect(dialog).toContainText('不会创建新的本地旅行副本')
  await expect(dialog).toContainText('不会自动合并')
  if (confirm) {
    await dialog.getByRole('button', { name: '用云端覆盖本地' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('header h1').first()).toHaveText(expectedCloudTitle)
  } else {
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toHaveCount(0)
  }
}

async function expectLocalTripTitle(page: Page, tripId: string, expectedTitle: string) {
  await expect.poll(async () => (await readLocalTripState(page, tripId)).title).toBe(expectedTitle)
  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('header h1').first()).toHaveText(expectedTitle)
}

async function updateLocalTripVersion(
  page: Page,
  tripId: string,
  title: string,
  itemTitle: string,
) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ itemTitle, title, tripId }) => {
    function openTravelConsoleDb() {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('TravelConsoleDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
      })
    }

    const db = await openTravelConsoleDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['trips', 'itineraryItems'], 'readwrite')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('更新测试旅行失败'))
      const now = Date.now()
      const tripRequest = transaction.objectStore('trips').get(tripId)
      tripRequest.onsuccess = () => {
        const trip = tripRequest.result
        if (trip) {
          transaction.objectStore('trips').put({ ...trip, title, updatedAt: now })
        }
      }
      const itemIndex = transaction.objectStore('itineraryItems').index('tripId')
      const itemsRequest = itemIndex.getAll(tripId)
      itemsRequest.onsuccess = () => {
        const [item] = itemsRequest.result
        if (item) {
          transaction.objectStore('itineraryItems').put({ ...item, title: itemTitle, updatedAt: now })
        }
      }
    })
  }, { itemTitle, title, tripId })
}

async function attachTinyImageTicket(page: Page, tripId: string) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (targetTripId) => {
    function openTravelConsoleDb() {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('TravelConsoleDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
      })
    }

    const db = await openTravelConsoleDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['trips', 'itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入测试票据失败'))
      const now = Date.now()
      const itemIndex = transaction.objectStore('itineraryItems').index('tripId')
      const itemsRequest = itemIndex.getAll(targetTripId)
      itemsRequest.onsuccess = () => {
        const [item] = itemsRequest.result
        if (!item) return
        const ticketId = `${targetTripId}_cloud_restore_ticket`
        const imageBytes = Uint8Array.from(
          window.atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),
          (char) => char.charCodeAt(0),
        )
        transaction.objectStore('itineraryItems').put({
          ...item,
          ticketIds: [...new Set([...(item.ticketIds ?? []), ticketId])],
          updatedAt: now,
        })
        transaction.objectStore('ticketMetas').put({
          createdAt: now,
          fileName: 'cloud-restore-ticket.png',
          fileType: 'image',
          id: ticketId,
          itemId: item.id,
          mimeType: 'image/png',
          scope: 'item',
          size: imageBytes.length,
          storageMode: 'copy',
          title: 'Cloud restore tiny ticket',
          tripId: targetTripId,
          updatedAt: now,
        })
        transaction.objectStore('ticketBlobs').put({
          blob: new Blob([imageBytes], { type: 'image/png' }),
          ticketId,
        })
        const tripRequest = transaction.objectStore('trips').get(targetTripId)
        tripRequest.onsuccess = () => {
          const trip = tripRequest.result
          if (trip) transaction.objectStore('trips').put({ ...trip, updatedAt: now })
        }
      }
    })
  }, tripId)
}

async function readLocalTripState(page: Page, tripId: string) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  return page.evaluate(async (targetTripId) => {
    function openTravelConsoleDb() {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('TravelConsoleDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
      })
    }

    function isRecordForE2e(value: unknown): value is Record<string, unknown> {
      return Boolean(value && typeof value === 'object' && !Array.isArray(value))
    }

    const db = await openTravelConsoleDb()
    const getAll = (storeName: string) => new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const [trips, ticketMetas, ticketBlobs] = await Promise.all([
      getAll('trips'),
      getAll('ticketMetas'),
      getAll('ticketBlobs'),
    ])
    db.close()
    const trip = trips.find((entry) => isRecordForE2e(entry) && entry.id === targetTripId)
    const ticket = ticketMetas.find((entry) => isRecordForE2e(entry) && entry.tripId === targetTripId)
    const ticketBlob = ticket && isRecordForE2e(ticket)
      ? ticketBlobs.find((entry) => isRecordForE2e(entry) && entry.ticketId === ticket.id)
      : null
    return {
      ticketBlobSize: isRecordForE2e(ticketBlob) && ticketBlob.blob instanceof Blob ? ticketBlob.blob.size : 0,
      ticketTitle: isRecordForE2e(ticket) && typeof ticket.title === 'string' ? ticket.title : null,
      title: isRecordForE2e(trip) && typeof trip.title === 'string' ? trip.title : null,
      tripCount: trips.length,
    }
  }, tripId)
}

async function readCloudFixtureBackupTitle(page: Page, tripId: string) {
  return page.evaluate((targetTripId) => {
    const raw = window.localStorage.getItem('tripmap:e2e:cloud-fixture')
    const fixture = raw ? JSON.parse(raw) as {
      backups?: Array<{ originalTripId?: string; title?: string }>
    } : null
    return fixture?.backups?.find((backup) => backup.originalTripId === targetTripId)?.title ?? null
  }, tripId)
}
