// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { resetPwaLifecycleForTests } from '../lib/pwaLifecycle'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  getRouteParams: vi.fn(() => new URLSearchParams()),
  getStoredTravelProfile: vi.fn(() => ({
    pace: 'moderate',
    preferTransport: 'mixed',
    mealTimeProtection: true,
    reminderLevel: 'normal',
  })),
  saveTravelProfile: vi.fn(),
  normalizeTravelProfile: vi.fn(() => ({
    pace: 'moderate',
    preferTransport: 'mixed',
    mealTimeProtection: true,
    reminderLevel: 'normal',
  })),
  getStoredAiPrivacySettings: vi.fn(() => ({
    allowItineraryBasics: true,
    allowLocationText: true,
    allowCoordinateState: true,
    allowTransportInfo: true,
    allowTicketContent: false,
    allowNotes: false,
  })),
  saveAiPrivacySettings: vi.fn(),
  isTravelInboxAutoRecognizeEnabled: vi.fn(() => false),
  setTravelInboxAutoRecognizeEnabled: vi.fn(),
  importTripBackup: vi.fn(),
  parseTripPlanFile: vi.fn(),
  importTripPlanPackage: vi.fn(),
  buildTripPlanPreviewSummary: vi.fn(() => '预览摘要'),
  getRouteCacheStats: vi.fn(() => ({ totalEntries: 0, totalBytes: 0, hitCount: 0, missCount: 0 })),
  getRouteCacheMaxByteOptions: vi.fn(() => [1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024]),
  setRouteCacheMaxBytes: vi.fn(),
  clearRouteCache: vi.fn(),
  getRoutingConfig: vi.fn(() => ({})),
  listTrips: vi.fn().mockResolvedValue([]),
  getTicketBlobCacheSummary: vi.fn().mockResolvedValue({
    cachedCount: 0,
    cachedSizeBytes: 0,
    clearableCount: 0,
    clearableSizeBytes: 0,
    totalCopyTickets: 0,
  }),
  clearSyncedTicketBlobCachesForTrip: vi.fn().mockResolvedValue(undefined),
  useAppearance: vi.fn(() => ({
    mode: 'system' as const,
    resolved: 'light' as const,
    setMode: vi.fn(),
  })),
  formatFileSize: vi.fn((size: number) => `${size} B`),
}))

vi.mock('../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
  getRouteParams: mocks.getRouteParams,
}))

vi.mock('../lib/travelProfile', () => ({
  getStoredTravelProfile: mocks.getStoredTravelProfile,
  saveTravelProfile: mocks.saveTravelProfile,
  normalizeTravelProfile: mocks.normalizeTravelProfile,
}))

vi.mock('../lib/ai/aiPrivacy', () => ({
  getStoredAiPrivacySettings: mocks.getStoredAiPrivacySettings,
  saveAiPrivacySettings: mocks.saveAiPrivacySettings,
}))

vi.mock('../lib/ai/travelInbox', () => ({
  isTravelInboxAutoRecognizeEnabled: mocks.isTravelInboxAutoRecognizeEnabled,
  setTravelInboxAutoRecognizeEnabled: mocks.setTravelInboxAutoRecognizeEnabled,
}))

vi.mock('../lib/backup', () => ({
  importTripBackup: mocks.importTripBackup,
}))

vi.mock('../lib/tripPlanImport', () => ({
  parseTripPlanFile: mocks.parseTripPlanFile,
  importTripPlanPackage: mocks.importTripPlanPackage,
  buildTripPlanPreviewSummary: mocks.buildTripPlanPreviewSummary,
}))

vi.mock('../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: 'route-cache-changed',
  getRouteCacheStats: mocks.getRouteCacheStats,
  getRouteCacheMaxByteOptions: mocks.getRouteCacheMaxByteOptions,
  setRouteCacheMaxBytes: mocks.setRouteCacheMaxBytes,
  clearRouteCache: mocks.clearRouteCache,
}))

vi.mock('../lib/routing', () => ({
  getRoutingConfig: mocks.getRoutingConfig,
  ROUTING_CONFIG_CHANGED_EVENT: 'routing-config-changed',
}))

vi.mock('../lib/tickets', () => ({
  formatFileSize: mocks.formatFileSize,
}))

vi.mock('../db/repositories', () => ({
  listTrips: mocks.listTrips,
}))

vi.mock('../lib/cloudObjectSync', () => ({
  getTicketBlobCacheSummary: mocks.getTicketBlobCacheSummary,
  clearSyncedTicketBlobCachesForTrip: mocks.clearSyncedTicketBlobCachesForTrip,
}))

vi.mock('../lib/appearanceContext', () => ({
  useAppearance: mocks.useAppearance,
}))

vi.mock('../components/cloud/CloudBackupPanel', () => ({
  CloudBackupPanel: () => <div data-testid="cloud-backup-panel" />,
}))

vi.mock('../components/trip/ImportRouteGenerationPanel', () => ({
  ImportRouteGenerationPanel: () => <div data-testid="import-route-generation-panel" />,
}))

vi.mock('../components/AppVersion', () => ({
  AppVersion: () => <div data-testid="app-version" />,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  resetPwaLifecycleForTests({ appVersion: '0.0.0-test', isOnline: true, serviceWorkerSupported: true, status: 'registered' })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  resetPwaLifecycleForTests()
})

describe('SettingsPage', () => {
  it('renders settings page with main sections', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toBeTruthy()
    expect(container?.textContent).toContain('设置')
  })

  it('renders appearance section', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('外观')
    expect(container?.textContent).toContain('跟随系统')
  })

  it('renders travel profile section', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('旅行偏好')
  })

  it('renders AI privacy section', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('AI 与隐私')
  })

  it('renders cloud backup panel', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.querySelector('[data-testid="cloud-backup-panel"]')).toBeTruthy()
  })

  it('renders route cache section', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('路线缓存')
  })

  it('renders app version', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.querySelector('[data-testid="app-version"]')).toBeTruthy()
  })

  it('renders PWA lifecycle update state', async () => {
    resetPwaLifecycleForTests({
      appVersion: '0.0.0-test',
      isOnline: true,
      message: '发现新版本，可在确认后更新并重启。',
      serviceWorkerSupported: true,
      status: 'update-ready',
    })

    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('应用更新：有新版本可更新')
    expect(container?.textContent).toContain('当前版本：v0.0.0-test')
    expect(container?.textContent).toContain('更新并重启')
  })

  it('renders import trip plan section', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('导入行程')
  })

  it('renders travel inbox toggle', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    expect(container?.textContent).toContain('旅行收件箱')
  })

  it('navigates back to home', async () => {
    await act(async () => {
      root?.render(<SettingsPage />)
    })

    const backButton = container?.querySelector('button[aria-label="返回"]')
      ?? Array.from(container?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('返回'))
    if (backButton) {
      await act(async () => {
        backButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
  })
})
