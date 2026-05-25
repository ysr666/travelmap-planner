import { expect, test } from '@playwright/test'
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
  if (!(await cloudSection.isVisible().catch(() => false))) {
    await page
      .locator('summary')
      .filter({ hasText: 'Supabase 云端保存与恢复' })
      .click()
  }

  await expect(cloudSection).toBeVisible()
  const message = page.getByTestId('supabase-unconfigured-message')
  await expect(message).toContainText('云端保存未配置')
  await expect(message).toContainText('VITE_SUPABASE_URL')
  await expect(message).toContainText('VITE_SUPABASE_ANON_KEY')
  await expect(cloudSection).toContainText('真实上传/恢复前')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('自动云端保存')
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

test('Trip Home 云端保存冲突提醒展示版本来源并明确原地更新语义', async ({ page }) => {
  await clearTravelDatabase(page)
  const trip = createSeedTrip({ id: 'trip_prompt', updatedAt: Date.parse('2026-04-02T10:00:00.000Z') })
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

  const card = page.getByTestId('trip-home-cloud-save-card')
  await expect(card).toContainText('本地和云端可能都有更新')
  await expect(card).toContainText('本地版本')
  await expect(card).toContainText('云端版本')
  await expect(card).toContainText('未上传修改')
  await expect(card.getByTestId('cloud-snapshot-upload')).toContainText('用本地覆盖云端')
  await expect(card.getByTestId('cloud-snapshot-restore')).toContainText('用云端覆盖本地')

  await card.getByTestId('cloud-snapshot-restore').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('用云端覆盖本地？')
  await expect(dialog).toContainText('当前未上传的本地修改可能被覆盖。')
  await expect(dialog).toContainText('不会创建新的本地旅行副本。')
  await expect(dialog).toContainText('不会自动合并')
  await expect(dialog).toContainText('本地版本时间')
  await expect(dialog).toContainText('云端版本时间')
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 本地版本较新时上传本地数据需要二次确认', async ({ page }) => {
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

  const card = page.getByTestId('trip-home-cloud-save-card')
  await expect(card).toContainText('本地版本较新')
  await expect(card.getByTestId('cloud-snapshot-upload')).toContainText('上传并覆盖云端保存')

  await card.getByTestId('cloud-snapshot-upload').click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await expect(dialog).toContainText('上传并覆盖云端保存？')
  await expect(dialog).toContainText('云端原有版本会被覆盖。')
  await expect(dialog).toContainText('不会自动合并')

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card).toContainText('本地版本较新')
  await expect(card).not.toContainText('本地版本已上传，云端保存已覆盖更新。')
  await expectNoHorizontalOverflow(page)
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
  await page.locator('summary').filter({ hasText: '路线服务' }).click()

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
