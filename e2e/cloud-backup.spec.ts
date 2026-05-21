import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseFixture,
  forceSupabaseUnconfigured,
  seedTravelRecords,
} from './helpers'

test('设置页 Supabase 未配置时显示云端备份提示且不显示登录上传控件', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  if (!(await cloudSection.isVisible().catch(() => false))) {
    await page
      .locator('summary')
      .filter({ hasText: 'Supabase 快照备份与恢复' })
      .first()
      .click()
  }

  await expect(cloudSection).toBeVisible()
  const message = page.getByTestId('supabase-unconfigured-message')
  await expect(message).toContainText('云端快照未配置')
  await expect(message).toContainText('VITE_SUPABASE_URL')
  await expect(message).toContainText('VITE_SUPABASE_ANON_KEY')
  await expect(
    page.getByText('真实上传/恢复前，请确认 Supabase RLS、Storage policy 和 Auth Redirect URL 已配置。'),
  ).toBeVisible()
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('自动云端快照备份')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('配置 Supabase 后才能开启。')
  await expect(page.getByTestId('auto-cloud-backup-toggle')).toBeDisabled()
  await expect(page.getByTestId('cloud-login-form')).toHaveCount(0)
  await expect(page.getByTestId('cloud-upload-current-trip')).toHaveCount(0)
  await expect(page.getByTestId('cloud-backup-list')).toHaveCount(0)
  await expect(page.getByTestId('cloud-snapshot-check-prompts')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('设置页通过 section=cloud 可以直接打开云端备份区域', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  await expect(cloudSection).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Day View 不显示云端快照检查提醒', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await createDemoTripViaUi(page)
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('本地新建和编辑旅行不受云端快照提醒干扰', async ({ page }) => {
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
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 云端快照提醒展示版本来源并明确恢复语义', async ({ page }) => {
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto(`/#/trip?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })

  const card = page.getByTestId('cloud-snapshot-check-card').first()
  await expect(card).toContainText('云端快照较新')
  await expect(card).toContainText('本地版本')
  await expect(card).toContainText('云端快照')
  await expect(card.getByTestId('cloud-snapshot-restore')).toContainText('恢复为新旅行副本')

  await card.getByTestId('cloud-snapshot-restore').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('会创建一个新的本地旅行副本')
  await expect(dialog).toContainText('不会覆盖当前本地旅行')
  await expect(dialog).toContainText('不会删除云端快照')
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 本地版本较新时上传本地快照需要二次确认', async ({ page }) => {
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

  const card = page.getByTestId('cloud-snapshot-check-card').first()
  await expect(card).toContainText('本地版本较新')
  await expect(card.getByTestId('cloud-snapshot-upload')).toContainText('上传本地快照')

  await card.getByTestId('cloud-snapshot-upload').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('上传本地快照？')
  await expect(dialog).toContainText('上传会创建一个新的云端快照')
  await expect(dialog).toContainText('不会删除旧快照')
  await expect(dialog).toContainText('不会把云端修改合并到当前本地旅行')

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card).toContainText('本地版本较新')
  await expect(page.getByText('本地快照已上传，已创建新的云端快照。')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('首页显示云端快照恢复副本来源标识', async ({ page }) => {
  await clearTravelDatabase(page)
  const original = createSeedTrip({ id: 'trip_original', updatedAt: Date.parse('2026-04-02T10:00:00.000Z') })
  const restored = createSeedTrip({
    id: 'trip_restored',
    restoredAt: Date.parse('2026-04-02T12:30:00.000Z'),
    restoredFromCloudBackupId: 'backup_1',
    restoredFromCloudExportedAt: '2026-04-02T10:00:00.000Z',
    restoredFromCloudOriginalTripId: original.id,
    updatedAt: Date.parse('2026-04-02T12:30:00.000Z'),
  })
  await seedTravelRecords(page, {
    days: [createSeedDay(original.id, 'day_original'), createSeedDay(restored.id, 'day_restored')],
    trips: [original, restored],
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('trip-card')).toHaveCount(2)
  const restoredLabel = page.getByTestId('restored-trip-source-label')
  await expect(restoredLabel).toContainText('由云端快照恢复')
  await expect(restoredLabel).toContainText('恢复于')
  const restoredLabelLayout = await restoredLabel.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    }
  })
  expect(restoredLabelLayout.whiteSpace).not.toBe('nowrap')
  expect(restoredLabelLayout.textOverflow).not.toBe('ellipsis')
  expect(restoredLabelLayout.scrollWidth).toBeLessThanOrEqual(restoredLabelLayout.clientWidth + 1)
  await expectNoHorizontalOverflow(page)
})

test('设置页云端列表按快照语义展示同一原旅行的多次快照', async ({ page }) => {
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
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })

  const list = page.getByTestId('cloud-backup-list')
  await expect(list).toContainText('原旅行')
  await expect(list).toContainText('2 个云端快照')
  await expect(list).toContainText('云端快照')
  await expect(list).toContainText('快照时间')
  await expect(list).toContainText('附件数量')
  await expect(list.getByTestId('cloud-restore-backup').first()).toContainText('恢复为新旅行副本')
  await expectNoHorizontalOverflow(page)
})

test('设置页可以保存和清除本机路线服务 key', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByText('路线服务配置', { exact: true }).click()

  await expect(page.getByTestId('routing-settings-section')).toBeVisible()
  const input = page.getByTestId('routing-api-key-input')
  await input.fill('local-routing-key')
  await page.getByTestId('routing-api-key-save').click()
  await expect(page.getByText('路线服务 key 已保存到当前浏览器本机。')).toBeVisible()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('路线服务配置', { exact: true }).click()
  await expect(page.getByTestId('routing-settings-section')).toContainText('已使用本机 key')
  await page.getByTestId('routing-api-key-clear').click()
  await expect(page.getByText('已清除本机路线服务 key')).toBeVisible()
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
