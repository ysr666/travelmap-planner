import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseFixture,
  forceSupabaseUnconfigured,
  seedTravelRecords,
} from './helpers'

test('设置页 Supabase 未配置时显示云端同步提示且不显示登录上传控件', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')

  await expect(cloudSection).toBeVisible()
  const message = page.getByTestId('supabase-unconfigured-message')
  await expect(message).toContainText('云端同步未配置')
  await expect(message).toContainText('VITE_SUPABASE_URL')
  await expect(message).toContainText('VITE_SUPABASE_ANON_KEY')
  await expect(cloudSection).toContainText('真实同步/恢复前')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('云端自动同步')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('配置 Supabase 后才能开启。')
  await expect(page.getByTestId('cloud-auto-sync-status')).toContainText('未配置')
  await expect(page.getByTestId('auto-cloud-backup-toggle')).toBeDisabled()
  await expect(page.getByTestId('cloud-login-form')).toHaveCount(0)
  await expect(page.getByTestId('cloud-upload-current-trip')).toHaveCount(0)
  await expect(page.getByTestId('cloud-backup-list')).toHaveCount(0)
  await expect(page.getByTestId('cloud-snapshot-check-prompts')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('设置页通过 section=cloud 可以直接打开云端同步区域', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  await expect(cloudSection).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('设置页轻量显示同步队列和票据上传状态', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await clearTravelDatabase(page)
  const trip = createSeedTrip({ id: 'trip_queue_summary', title: '同步队列旅行' })
  const ticket = createSeedTicket(trip.id, {
    id: 'ticket_queue_summary',
    title: '迪士尼门票',
  })
  await seedTravelRecords(page, {
    ticketMetas: [ticket],
    trips: [trip],
  })
  await forceSupabaseFixture(page, {
    backups: [],
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await page.evaluate(() => window.localStorage.setItem('tripmap:cloud-auto-snapshot:enabled', '0'))
  await seedSyncQueueSummary(page, { ticket, trip })

  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })

  const summary = page.getByTestId('cloud-sync-queue-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('还有 2 项')
  await expect(summary).toContainText('上次同步')
  await expect(summary).toContainText('1 个处理中')
  await summary.getByText('查看同步明细').click()
  await expect(summary).toContainText('1 个对象等待同步')
  await expect(summary).toContainText('迪士尼门票')
  await expect(summary).toContainText('等待上传')
  await expectNoHorizontalOverflow(page)
})

test('设置页对象同步字段冲突需要确认后才写入', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await clearTravelDatabase(page)
  const trip = createSeedTrip({ id: 'trip_object_conflict' })
  const day = createSeedDay(trip.id, 'day_object_conflict')
  const baseItem = createSeedItem(trip.id, day.id, {
    id: 'item_object_conflict',
    title: '涩谷散步',
  })
  const localItem = {
    ...baseItem,
    title: '此设备标题',
    updatedAt: Date.parse('2026-04-02T11:00:00.000Z'),
  }
  await seedTravelRecords(page, {
    days: [day],
    itineraryItems: [localItem],
    trips: [trip],
  })
  await forceSupabaseFixture(page, {
    backups: [],
    user: { email: 'qa@example.com', id: 'user_1' },
  })
  await seedObjectSyncConflict(page, {
    baseItem,
    localItem,
    remoteItem: {
      ...baseItem,
      title: '账号标题',
      updatedAt: Date.parse('2026-04-02T12:00:00.000Z'),
    },
    tripId: trip.id,
  })

  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('cloud-auto-sync-status')).toContainText('需要处理冲突')
  const panel = page.getByTestId('object-sync-conflict-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('此设备标题')
  await expect(panel).toContainText('账号标题')

  await panel.getByText('账号版本').click()
  await panel.getByRole('button', { name: '应用解决方案' }).click()
  const dialog = page.getByTestId('object-sync-conflict-confirm-dialog')
  await expect(dialog).toContainText('确认前不会改动本地数据')
  await expect.poll(async () => readLocalItemTitle(page, localItem.id)).toBe('此设备标题')

  await dialog.getByRole('button', { name: '确认应用' }).click()
  await expect.poll(async () => readLocalItemTitle(page, localItem.id)).toBe('账号标题')
  await expect(panel.getByTestId('object-sync-conflict-card')).toHaveCount(0)
  await expect(page.locator('body')).toContainText('冲突已处理，已加入同步队列')
  await expectNoHorizontalOverflow(page)
})

test('Day View 不显示云端同步检查提醒', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await createDemoTripViaUi(page)
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expect(page.getByTestId('trip-home-cloud-save-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('本地新建和编辑旅行不受云端同步提醒干扰', async ({ page }) => {
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

test('Trip Home 此设备和账号同时变更时按最新版本无感自动同步', async ({ page }) => {
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
  await expect.poll(async () => readCloudFixtureBackupTitle(page, trip.id), { timeout: 15_000 }).toBe(trip.title)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 此设备版本较新且无冲突时会自动立即同步', async ({ page }) => {
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

test('账号数据同步确认会原地覆盖此设备旅行并在刷新后保留账号数据', async ({ page }) => {
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
  const titleV3 = '云端恢复 QA V3 此设备修改'
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

test('设置页云端列表展示历史遗留的同一旅行多条云端同步', async ({ page }) => {
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
  await expect(list).toContainText('旧版本可能留下多条历史备份')
  await expect(list).toContainText('不会自动清理')
  await expect(list).toContainText('云端同步')
  await expect(list).toContainText('账号数据时间')
  await expect(list).toContainText('附件数量')
  const newestBackupCard = list.getByTestId('cloud-backup-card').filter({ hasText: '旧版备份 2' })
  await expect(newestBackupCard.getByTestId('cloud-restore-backup')).toContainText('同步到此设备')
  await newestBackupCard.getByTestId('cloud-restore-backup').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('同步账号数据到此设备？')
  await expect(dialog).toContainText('不会创建重复旅行。')
  await expect(dialog).toContainText('账号数据时间')
  await expectNoHorizontalOverflow(page)
})

test('设置页只显示通用路线服务状态和缓存管理', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('routing-settings-section')).toBeVisible()
  await expect(page.getByText('高级与迁移', { exact: true })).toBeVisible()
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

function createSeedItem(tripId: string, dayId: string, patch: Record<string, unknown> = {}) {
  return {
    createdAt: Date.parse('2026-04-02T10:00:00.000Z'),
    dayId,
    id: 'item_1',
    sortOrder: 1,
    ticketIds: [],
    title: '涩谷散步',
    tripId,
    updatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
    ...patch,
  }
}

function createSeedTicket(tripId: string, patch: Record<string, unknown> = {}) {
  return {
    createdAt: Date.parse('2026-04-02T10:00:00.000Z'),
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    id: 'ticket_1',
    mimeType: 'application/pdf',
    size: 1200,
    storageMode: 'copy',
    title: '票据',
    tripId,
    updatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
    ...patch,
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

async function seedSyncQueueSummary(
  page: Page,
  input: {
    ticket: ReturnType<typeof createSeedTicket>
    trip: ReturnType<typeof createSeedTrip>
  },
) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ ticket, trip }) => {
    window.localStorage.setItem(
      'tripmap:cloud-auto-snapshot:state',
      JSON.stringify({
        trips: {
          [trip.id]: {
            lastSuccessAt: Date.parse('2026-04-02T09:00:00.000Z'),
            status: 'synced',
            tripId: trip.id,
          },
        },
        version: 1,
      }),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['syncOutbox', 'objectSyncStates', 'ticketBlobSyncStates'], 'readwrite')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入同步队列测试数据失败'))
      const objectKey = `trip:${trip.id}`
      transaction.objectStore('syncOutbox').put({
        attempts: 0,
        createdAt: Date.now(),
        deviceId: 'e2e-device',
        id: 'sync_outbox_queue_summary',
        objectId: trip.id,
        objectKey,
        objectType: 'trip',
        operation: 'upsert',
        opId: 'op_queue_summary',
        payload: trip,
        status: 'pending',
        tripId: trip.id,
        updatedAt: Date.now(),
        updatedAtMs: trip.updatedAt,
      })
      transaction.objectStore('objectSyncStates').put({
        localUpdatedAtMs: trip.updatedAt,
        objectId: trip.id,
        objectKey,
        objectType: 'trip',
        tripId: trip.id,
      })
      transaction.objectStore('ticketBlobSyncStates').put({
        cacheStatus: 'cached',
        fileName: ticket.fileName,
        mimeType: ticket.mimeType,
        size: ticket.size,
        ticketId: ticket.id,
        tripId: trip.id,
        updatedAt: Date.now(),
        uploadStatus: 'pending',
      })
    })
  }, input)
}

async function seedObjectSyncConflict(
  page: Page,
  input: {
    baseItem: ReturnType<typeof createSeedItem>
    localItem: ReturnType<typeof createSeedItem>
    remoteItem: ReturnType<typeof createSeedItem>
    tripId: string
  },
) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ baseItem, localItem, remoteItem, tripId }) => {
    const objectKey = `item:${localItem.id}`
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['objectSyncConflicts', 'objectSyncStates', 'objectSyncBases'], 'readwrite')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入测试冲突失败'))
      const now = Date.now()
      transaction.objectStore('objectSyncBases').put({
        cloudUpdatedAtMs: baseItem.updatedAt,
        objectId: localItem.id,
        objectKey,
        objectType: 'item',
        payload: baseItem,
        tripId,
        updatedAt: now,
      })
      transaction.objectStore('objectSyncStates').put({
        conflictAt: now,
        conflictReason: '同一对象的同一字段在此设备和账号中都有不同修改。',
        localUpdatedAtMs: localItem.updatedAt,
        objectId: localItem.id,
        objectKey,
        objectType: 'item',
        tripId,
      })
      transaction.objectStore('objectSyncConflicts').put({
        basePayload: baseItem,
        conflictType: 'field_conflict',
        createdAt: now,
        fields: [{
          baseValue: baseItem.title,
          defaultResolution: 'local',
          fieldPath: 'title',
          label: '标题',
          localValue: localItem.title,
          remoteValue: remoteItem.title,
        }],
        id: 'object_conflict_e2e',
        localPayload: localItem,
        objectId: localItem.id,
        objectKey,
        objectLabel: localItem.title,
        objectType: 'item',
        remotePayload: remoteItem,
        status: 'pending',
        tripId,
        updatedAt: now,
      })
    })
  }, input)
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
  const details = page.locator('#trip-sync-archive-section details').first()
  await details.evaluate((element) => {
    element.open = true
  })
  await expect(page.getByTestId('cloud-backup-section')).toBeVisible()
}

async function expectUploadCurrentTrip(page: Page, tripId: string, expectedTitle: string) {
  await openCloudBackupPanel(page, tripId)
  await page.getByTestId('cloud-upload-current-trip').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('账号中原有版本会被覆盖')
  await expect(dialog).toContainText('不会创建新的云端记录列表')
  await expect(dialog).toContainText('当前方向操作不会自动合并')
  await dialog.getByRole('button', { name: '立即同步' }).click()
  await expect(page.locator('body')).toContainText('此设备版本已同步到账号')
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
  await expect(dialog).toContainText('将用账号数据更新此设备旅行')
  await expect(dialog).toContainText('不会创建重复旅行')
  await expect(dialog).toContainText('当前方向操作不会自动合并')
  if (confirm) {
    await dialog.getByRole('button', { name: '同步账号数据到此设备' }).click()
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
      const transaction = db.transaction(['trips', 'itineraryItems', 'syncOutbox', 'objectSyncStates'], 'readwrite')
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
          const nextTrip = { ...trip, title, updatedAt: now }
          transaction.objectStore('trips').put(nextTrip)
          enqueueObject('trip', nextTrip.id, nextTrip.id, nextTrip, now)
        }
      }
      const itemIndex = transaction.objectStore('itineraryItems').index('tripId')
      const itemsRequest = itemIndex.getAll(tripId)
      itemsRequest.onsuccess = () => {
        const [item] = itemsRequest.result
        if (item) {
          const nextItem = { ...item, title: itemTitle, updatedAt: now }
          transaction.objectStore('itineraryItems').put(nextItem)
          enqueueObject('item', nextItem.id, nextItem.tripId, nextItem, now)
        }
      }

      function enqueueObject(objectType: string, objectId: string, objectTripId: string, payload: Record<string, unknown>, updatedAtMs: number) {
        const objectKey = `${objectType}:${objectId}`
        const entry = {
          attempts: 0,
          createdAt: updatedAtMs,
          deviceId: 'e2e-device',
          id: `sync_outbox_${objectType}_${objectId}_${updatedAtMs}`,
          objectId,
          objectKey,
          objectType,
          operation: 'upsert',
          opId: `op_${objectType}_${objectId}_${updatedAtMs}`,
          payload,
          status: 'pending',
          tripId: objectTripId,
          updatedAt: updatedAtMs,
          updatedAtMs,
        }
        transaction.objectStore('syncOutbox').put(entry)
        transaction.objectStore('objectSyncStates').put({
          localUpdatedAtMs: updatedAtMs,
          objectId,
          objectKey,
          objectType,
          tripId: objectTripId,
        })
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

async function readLocalItemTitle(page: Page, itemId: string) {
  return page.evaluate(async (targetItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    const item = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = db.transaction('itineraryItems', 'readonly').objectStore('itineraryItems').get(targetItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return typeof item?.title === 'string' ? item.title : null
  }, itemId)
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
