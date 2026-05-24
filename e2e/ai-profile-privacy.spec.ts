import { expect, test } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow } from './helpers'

test('设置页可以配置旅行偏好和 AI 隐私数据范围', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.localStorage.removeItem('tripmap:appearance')
    window.localStorage.removeItem('tripmap:travel-profile')
    window.localStorage.removeItem('tripmap:ai-privacy')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.locator('summary').filter({ hasText: '旅行偏好' }).click()
  const profileSection = page.getByTestId('travel-profile-section')
  await expect(profileSection).toBeVisible()
  await expect(profileSection).toContainText('设备内运行')
  await expect(page.getByTestId('travel-profile-pace-moderate')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('travel-profile-pace-relaxed').click()
  await page.getByTestId('travel-profile-transport-walking').click()
  await page.getByTestId('travel-profile-meal-protection').click()
  await page.getByTestId('travel-profile-morning-start').fill('09:30')
  await page.getByTestId('travel-profile-night-return').fill('22:00')
  await page.getByTestId('travel-profile-reminder-detailed').click()

  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('tripmap:travel-profile') ?? '{}'))).toEqual({
    mealTimeProtection: false,
    morningStartAfter: '09:30',
    nightReturnBefore: '22:00',
    pace: 'relaxed',
    preferTransport: 'walking',
    reminderLevel: 'detailed',
  })

  await page.locator('summary').filter({ hasText: 'AI 与隐私' }).click()
  const privacySection = page.getByTestId('ai-privacy-section')
  await expect(privacySection).toBeVisible()
  await expect(privacySection).toContainText('AI 草稿生成和修复')
  await expect(privacySection).toContainText('不会调用外部 AI')
  await expect(privacySection).toContainText('票据图片/PDF')

  await expect(page.getByTestId('ai-privacy-allowItineraryBasics')).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('ai-privacy-allowItineraryBasics').click()
  await page.getByTestId('ai-privacy-allowTicketFileNames').click()
  await expect(page.getByTestId('ai-privacy-allowTicketFileContent')).toBeDisabled()
  await expect(page.getByTestId('ai-privacy-allowTicketFileContent')).toHaveAttribute('aria-checked', 'false')

  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('tripmap:ai-privacy') ?? '{}'))).toMatchObject({
    allowItineraryBasics: true,
    allowTicketFileContent: false,
    allowTicketFileNames: true,
  })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('summary').filter({ hasText: '旅行偏好' }).click()
  await expect(page.getByTestId('travel-profile-pace-relaxed')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('travel-profile-transport-walking')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('travel-profile-meal-protection')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('travel-profile-morning-start')).toHaveValue('09:30')
  await expect(page.getByTestId('travel-profile-night-return')).toHaveValue('22:00')
  await expect(page.getByTestId('travel-profile-reminder-detailed')).toHaveAttribute('aria-pressed', 'true')

  await page.locator('summary').filter({ hasText: 'AI 与隐私' }).click()
  await expect(page.getByTestId('ai-privacy-allowItineraryBasics')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('ai-privacy-allowTicketFileNames')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('ai-privacy-allowTicketFileContent')).toBeDisabled()

  await page.getByTestId('appearance-mode-dark').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(profileSection).toBeVisible()
  await expect(privacySection).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('未来 AI 隐私开关关闭时本地简报仍保持只读可见', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)

  const dayBrief = page.getByTestId('day-local-brief-card')
  await expect(dayBrief).toBeVisible()
  await expect(dayBrief).toContainText('本地检查')
  await expect(dayBrief.getByRole('button')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  const localCheck = page.getByTestId('local-trip-check-card')
  await expect(localCheck).toBeVisible()
  await expect(localCheck).toContainText('行程体检')
  await expect(localCheck).toContainText('本地检查')
  await expect(localCheck.getByRole('button')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.locator('summary').filter({ hasText: 'AI 与隐私' }).click()
  await expect(page.getByTestId('ai-privacy-allowItineraryBasics')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('ai-privacy-allowFullNotes')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('ai-privacy-allowTicketFileContent')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})
