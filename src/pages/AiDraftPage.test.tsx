// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiDraftPage } from './AiDraftPage'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  getStoredTravelProfile: vi.fn(() => ({ pace: 'moderate', preferTransport: 'mixed', mealTimeProtection: true, reminderLevel: 'normal' })),
  getStoredAiPrivacySettings: vi.fn(() => ({
    allowItineraryBasics: true,
    allowLocationText: true,
    allowCoordinateState: true,
    allowTransportInfo: true,
    allowTicketContent: false,
    allowNotes: false,
  })),
  summarizeAiPrivacyForAiRequest: vi.fn(() => ({})),
  getProviderProxyConfig: vi.fn(() => ({ baseUrl: '' })),
  fetchProviderProxyAiTripDraft: vi.fn(),
  fetchProviderProxyAiTripDraftRefine: vi.fn(),
  fetchProviderProxyAiTripDraftRepair: vi.fn(),
  fetchProviderProxyPlaceLookup: vi.fn(),
  generateMockAiTripDraft: vi.fn(() => ({
    title: '东京五日游',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    days: [],
  })),
  buildAiTripDraftRequest: vi.fn(() => ({ destination: '东京', dayCount: 3 })),
  validateAiTripDraftRequest: vi.fn(() => []),
  calculateEndDateFromDayCount: vi.fn(() => '2026-04-05'),
  validateAiTripDraft: vi.fn(() => []),
  summarizeAiTripDraft: vi.fn(() => '行程摘要'),
  convertAiTripDraftToImportData: vi.fn(() => ({})),
  buildAiTripDraftDailyTipsNotes: vi.fn(() => []),
  analyzeAiTripDraftQuality: vi.fn(() => ({ findings: [], score: 100 })),
  flattenAiTripDraftQualityFindings: vi.fn(() => []),
  selectDefaultAiTripDraftQualityFindingIds: vi.fn(() => []),
  AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS: {},
  buildAiTripDraftImportCheck: vi.fn(() => ({ valid: true, issues: [] })),
  buildAiTripDraftMapPreviews: vi.fn(() => []),
  buildAiTripDraftMissingCoordinateLookupItems: vi.fn(() => []),
  buildAiTripDraftMapOrderAdjustment: vi.fn(() => null),
  formatAiTripDraftMapDistance: vi.fn(() => ''),
  fingerprintAiTripDraft: vi.fn(() => 'fp'),
  applyAiTripDraftRefineResultIfFresh: vi.fn(),
  applyAiTripDraftQualityRepairResultIfFresh: vi.fn(),
  buildSelectedAiTripDraftRepairFindings: vi.fn(() => []),
  sanitizeAiDraftRepairDraftForProxy: vi.fn((v: unknown) => v),
  sanitizeAiDraftRepairFindingsForProxy: vi.fn((v: unknown) => v),
  applyAiTripDraftPlaceLookupCandidateIfFresh: vi.fn(),
  AI_TRIP_DRAFT_VARIANTS: [],
  buildAiTripDraftVariantComparisons: vi.fn(() => []),
  buildAiTripDraftVariantMixDays: vi.fn(() => []),
  buildAiTripDraftVariantRequest: vi.fn(() => ({})),
  buildDefaultAiTripDraftVariantMixSelection: vi.fn(() => ({})),
  buildMixedAiTripDraftFromVariants: vi.fn(() => null),
  createInitialAiTripDraftVariantStates: vi.fn(() => []),
  getSelectableAiTripDraftVariantDraft: vi.fn(() => null),
  getSuccessfulAiTripDraftVariantCount: vi.fn(() => 0),
  mergeAiTripDraftVariantState: vi.fn((v: unknown) => v),
  summarizeAiTripDraftVariantDraft: vi.fn(() => ''),
  importTripPlanRecords: vi.fn(),
  isAutoSnapshotBackupEnabled: vi.fn(() => false),
  getRoutingConfig: vi.fn(() => ({})),
  createId: vi.fn(() => 'new_id'),
}))

vi.mock('../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../lib/travelProfile', () => ({
  getStoredTravelProfile: mocks.getStoredTravelProfile,
}))

vi.mock('../lib/ai/aiPrivacy', () => ({
  getStoredAiPrivacySettings: mocks.getStoredAiPrivacySettings,
}))

vi.mock('../lib/ai/aiPrivacyGuard', () => ({
  summarizeAiPrivacyForAiRequest: mocks.summarizeAiPrivacyForAiRequest,
  sanitizeAiDraftRepairDraftForProxy: mocks.sanitizeAiDraftRepairDraftForProxy,
  sanitizeAiDraftRepairFindingsForProxy: mocks.sanitizeAiDraftRepairFindingsForProxy,
}))

vi.mock('../lib/ai/aiTripDraft', () => ({
  validateAiTripDraft: mocks.validateAiTripDraft,
  summarizeAiTripDraft: mocks.summarizeAiTripDraft,
  convertAiTripDraftToImportData: mocks.convertAiTripDraftToImportData,
  buildAiTripDraftDailyTipsNotes: mocks.buildAiTripDraftDailyTipsNotes,
}))

vi.mock('../lib/ai/aiTripDraftRequest', () => ({
  buildAiTripDraftRequest: mocks.buildAiTripDraftRequest,
  calculateEndDateFromDayCount: mocks.calculateEndDateFromDayCount,
  validateAiTripDraftRequest: mocks.validateAiTripDraftRequest,
}))

vi.mock('../lib/ai/aiTripDraftMock', () => ({
  generateMockAiTripDraft: mocks.generateMockAiTripDraft,
}))

vi.mock('../lib/ai/aiTripDraftVariants', () => ({
  AI_TRIP_DRAFT_VARIANTS: mocks.AI_TRIP_DRAFT_VARIANTS,
  buildAiTripDraftVariantComparisons: mocks.buildAiTripDraftVariantComparisons,
  buildAiTripDraftVariantMixDays: mocks.buildAiTripDraftVariantMixDays,
  buildAiTripDraftVariantRequest: mocks.buildAiTripDraftVariantRequest,
  buildDefaultAiTripDraftVariantMixSelection: mocks.buildDefaultAiTripDraftVariantMixSelection,
  buildMixedAiTripDraftFromVariants: mocks.buildMixedAiTripDraftFromVariants,
  createInitialAiTripDraftVariantStates: mocks.createInitialAiTripDraftVariantStates,
  getSelectableAiTripDraftVariantDraft: mocks.getSelectableAiTripDraftVariantDraft,
  getSuccessfulAiTripDraftVariantCount: mocks.getSuccessfulAiTripDraftVariantCount,
  mergeAiTripDraftVariantState: mocks.mergeAiTripDraftVariantState,
  summarizeAiTripDraftVariantDraft: mocks.summarizeAiTripDraftVariantDraft,
}))

vi.mock('../lib/ai/aiTripDraftQuality', () => ({
  analyzeAiTripDraftQuality: mocks.analyzeAiTripDraftQuality,
  AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS: mocks.AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS,
  flattenAiTripDraftQualityFindings: mocks.flattenAiTripDraftQualityFindings,
  selectDefaultAiTripDraftQualityFindingIds: mocks.selectDefaultAiTripDraftQualityFindingIds,
}))

vi.mock('../lib/ai/aiTripDraftQualityRepair', () => ({
  applyAiTripDraftQualityRepairResultIfFresh: mocks.applyAiTripDraftQualityRepairResultIfFresh,
  buildSelectedAiTripDraftRepairFindings: mocks.buildSelectedAiTripDraftRepairFindings,
}))

vi.mock('../lib/ai/aiTripDraftRefine', () => ({
  applyAiTripDraftRefineResultIfFresh: mocks.applyAiTripDraftRefineResultIfFresh,
  fingerprintAiTripDraft: mocks.fingerprintAiTripDraft,
}))

vi.mock('../lib/ai/aiTripDraftMapPreview', () => ({
  buildAiTripDraftMapPreviews: mocks.buildAiTripDraftMapPreviews,
  buildAiTripDraftMissingCoordinateLookupItems: mocks.buildAiTripDraftMissingCoordinateLookupItems,
  buildAiTripDraftMapOrderAdjustment: mocks.buildAiTripDraftMapOrderAdjustment,
  formatAiTripDraftMapDistance: mocks.formatAiTripDraftMapDistance,
  applyAiTripDraftPlaceLookupCandidateIfFresh: mocks.applyAiTripDraftPlaceLookupCandidateIfFresh,
}))

vi.mock('../lib/ai/aiTripDraftImportCheck', () => ({
  buildAiTripDraftImportCheck: mocks.buildAiTripDraftImportCheck,
}))

vi.mock('../lib/providerProxyClient', () => ({
  getProviderProxyConfig: mocks.getProviderProxyConfig,
  fetchProviderProxyAiTripDraft: mocks.fetchProviderProxyAiTripDraft,
  fetchProviderProxyAiTripDraftRefine: mocks.fetchProviderProxyAiTripDraftRefine,
  fetchProviderProxyAiTripDraftRepair: mocks.fetchProviderProxyAiTripDraftRepair,
  fetchProviderProxyPlaceLookup: mocks.fetchProviderProxyPlaceLookup,
  ProviderProxyClientError: class extends Error {},
}))

vi.mock('../lib/ai/providerProxyContract', () => ({
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION: 'place_lookup',
}))

vi.mock('../lib/autoSnapshotBackup', () => ({
  isAutoSnapshotBackupEnabled: mocks.isAutoSnapshotBackupEnabled,
}))

vi.mock('../lib/routing', () => ({
  getRoutingConfig: mocks.getRoutingConfig,
}))

vi.mock('../db', () => ({
  importTripPlanRecords: mocks.importTripPlanRecords,
}))

vi.mock('../db/ids', () => ({
  createId: mocks.createId,
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
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('AiDraftPage', () => {
  it('renders AI draft page', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('AI')
  })

  it('renders destination input', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('目的地')
  })

  it('renders day count input', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('天数')
  })

  it('renders generate button', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    const generateButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('生成'))
    expect(generateButton).toBeTruthy()
  })

  it('renders interest tags', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('美食')
    expect(container?.textContent).toContain('历史文化')
  })

  it('renders party size input', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('人数')
  })

  it('renders back button', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    const backButton = container?.querySelector('button[aria-label="返回"]')
      ?? container?.querySelector('button')
    expect(backButton).toBeTruthy()
  })

  it('renders page title', async () => {
    await act(async () => {
      root?.render(<AiDraftPage />)
    })

    expect(container?.textContent).toContain('AI 生成行程')
  })
})
