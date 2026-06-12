import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { clearTravelDatabase, clickTripCard, getHashParam } from './helpers'

const MOBILE_VIEWPORT = { width: 390, height: 844 }
const SHORT_MOBILE_VIEWPORT = { width: 390, height: 667 }
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

test.describe('390px mobile UX and accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await blockExternalCalls(page)
  })

  test('primary user paths avoid overflow, inaccessible controls, and serious axe issues', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await clearTravelDatabase(page)
    await page.evaluate(() => window.localStorage.setItem('tripmap:appearance', 'light'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await auditMobilePage(page, 'home-empty')

    await page.getByRole('button', { name: '创建示例旅行' }).click()
    await expect(page.getByTestId('trip-card')).toBeVisible()
    await auditMobilePage(page, 'home-demo')

    const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
    await clickTripCard(tripCard)
    await expect(page).toHaveURL(/#\/trip\?tripId=/)
    const tripId = getHashParam(page.url(), 'tripId')
    expect(tripId).toBeTruthy()
    await auditMobilePage(page, 'trip-workspace')

    await page.getByRole('button', { name: /抵达与涩谷/ }).click()
    await expect(page).toHaveURL(/#\/day\?/)
    const dayId = getHashParam(page.url(), 'dayId')
    expect(dayId).toBeTruthy()
    await auditMobilePage(page, 'day-schedule')

    await page.getByTestId('view-switch-map').click()
    await auditMobilePage(page, 'day-map')
    await page.getByTestId('view-switch-schedule').click()

    await page.getByRole('button', { name: /明治神宫散步/ }).click()
    await expect(page).toHaveURL(/#\/item\?/)
    const itemId = getHashParam(page.url(), 'itemId')
    expect(itemId).toBeTruthy()
    await auditMobilePage(page, 'item-detail')

    await page.getByRole('button', { name: '删除行程点' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(/确认删除/)
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '删除行程点' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.goto(`/#/item/edit?tripId=${tripId}&dayId=${dayId}&itemId=${itemId}&view=schedule`)
    await auditMobilePage(page, 'item-edit')
    await page.goto(`/#/item/new?tripId=${tripId}&dayId=${dayId}&view=schedule`)
    await auditMobilePage(page, 'item-new')

    await page.goto(`/#/trip/edit?tripId=${tripId}`)
    await auditMobilePage(page, 'trip-edit')
    await page.goto('/#/trip/new')
    await auditMobilePage(page, 'trip-new')

    await page.goto(`/#/tickets?tripId=${tripId}`)
    await auditMobilePage(page, 'ticket-library')
    await page.goto(`/#/documents?tripId=${tripId}`)
    await auditMobilePage(page, 'travel-document-center')
    await page.goto('/#/inbox')
    await auditMobilePage(page, 'travel-inbox')
    await page.goto('/#/search')
    await auditMobilePage(page, 'search')
    await page.goto('/#/settings')
    await auditMobilePage(page, 'settings')
    await page.goto('/#/settings/privacy')
    await auditMobilePage(page, 'settings-privacy')
    await page.goto('/#/settings/maps')
    await auditMobilePage(page, 'settings-maps')
    await page.goto('/#/settings/route')
    await auditMobilePage(page, 'settings-route')
    await page.goto('/#/ai-draft')
    await auditMobilePage(page, 'ai-draft')

    await page.setViewportSize(SHORT_MOBILE_VIEWPORT)
    await page.goto(`/#/item?tripId=${tripId}&dayId=${dayId}&itemId=${itemId}&view=schedule`)
    const shortDeleteButton = page.getByTestId('item-detail-page').getByRole('button', { name: '删除行程点' })
    await shortDeleteButton.scrollIntoViewIfNeeded()
    await shortDeleteButton.click()
    const shortDialog = page.getByRole('dialog')
    await expect(shortDialog).toBeVisible()
    await expect(shortDialog).toHaveAccessibleName(/确认删除/)
    await expect(shortDialog.getByRole('button', { name: '取消' })).toBeFocused()
    await auditMobilePage(page, 'short-confirm-dialog')

    expect(
      consoleErrors.filter((message) => !message.includes('Auth session missing')),
    ).toEqual([])
  })
})

async function auditMobilePage(page: Page, label: string) {
  await page.waitForLoadState('domcontentloaded')
  await waitForStableMobilePage(page)
  await expectNoHorizontalOverflow(page, label)
  await expectNoUnnamedControls(page, label)
  await expectNoSmallTouchTargets(page, label)
  await expectNoSeriousAxeViolations(page, label)
}

async function waitForStableMobilePage(page: Page) {
  await page.waitForFunction(() =>
    !Array.from(document.querySelectorAll('.animate-pulse')).some((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
    }) &&
    document.getAnimations().every((animation) => {
      const timing = animation.effect?.getTiming()
      return animation.playState !== 'running' || timing?.iterations === Infinity
    }),
  )
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

async function blockExternalCalls(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (LOCAL_HOSTS.has(url.hostname) || url.protocol === 'blob:' || url.protocol === 'data:') {
      await route.continue()
      return
    }
    await route.fulfill({
      body: '',
      contentType: 'text/plain',
      status: 204,
    })
  })
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    return documentWidth - window.innerWidth
  })
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(2)
}

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const serious = result.violations.filter((violation) =>
    violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(formatAxeViolations(serious), `${label} has serious/critical axe violations`).toEqual([])
}

async function expectNoUnnamedControls(page: Page, label: string) {
  const { unnamed } = await collectMobileControlAudit(page)
  expect(unnamed, `${label} has unnamed interactive controls`).toEqual([])
}

async function expectNoSmallTouchTargets(page: Page, label: string) {
  const { smallTargets } = await collectMobileControlAudit(page)
  expect(smallTargets, `${label} has touch targets smaller than 44px`).toEqual([])
}

async function collectMobileControlAudit(page: Page) {
  return await page.evaluate(() => {
    function isVisible(element: Element) {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
    }

    function isSkipped(element: Element) {
      if (element.closest('[data-mobile-target-exempt]')) return true
      return element instanceof HTMLInputElement &&
        element.type === 'file' &&
        element.classList.contains('sr-only')
    }

    function getLabelRect(element: Element) {
      if (!(element instanceof HTMLInputElement)) return null
      if (element.type !== 'checkbox' && element.type !== 'radio') return null
      const label = element.closest('label') ?? (
        element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null
      )
      if (!label || !isVisible(label)) return null
      return label.getBoundingClientRect()
    }

    function getMeasuredRect(element: Element) {
      return getLabelRect(element) ?? element.getBoundingClientRect()
    }

    function getTextByIdList(value: string | null) {
      if (!value) return ''
      return value
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
    }

    function getAccessibleName(element: Element) {
      const direct = element.getAttribute('aria-label')?.trim()
      if (direct) return direct

      const labelledBy = getTextByIdList(element.getAttribute('aria-labelledby')).trim()
      if (labelledBy) return labelledBy

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const explicitLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim() : ''
        const wrappedLabel = element.closest('label')?.textContent?.trim()
        const placeholder = element.getAttribute('placeholder')?.trim()
        return [explicitLabel, wrappedLabel, placeholder].find(Boolean)?.replace(/\s+/g, ' ') ?? ''
      }

      return (
        element.textContent?.trim() ||
        element.getAttribute('title')?.trim() ||
        ''
      ).replace(/\s+/g, ' ')
    }

    const selector = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="switch"]',
      '[role="radio"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const controls = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => !element.hasAttribute('disabled'))
      .filter((element) => !isSkipped(element))
      .filter((element) => isVisible(element) || getLabelRect(element))
      .map((element) => ({ element, name: getAccessibleName(element), rect: getMeasuredRect(element) }))

    return {
      smallTargets: controls
        .map(({ element, name, rect }) => ({
          height: Math.round(rect.height),
          name,
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width),
        }))
        .filter((target) => target.width < 44 || target.height < 44),
      unnamed: controls
        .filter(({ name }) => !name)
        .map(({ element, rect }) => ({
          height: Math.round(rect.height),
          html: element.outerHTML.slice(0, 180),
          width: Math.round(rect.width),
        })),
    }
  })
}

function formatAxeViolations(violations: Array<{ id: string; impact?: string | null; nodes: Array<{ failureSummary?: string; target: string[] }> }>) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.slice(0, 5).map((node) => ({
      summary: node.failureSummary,
      target: node.target,
    })),
  }))
}
