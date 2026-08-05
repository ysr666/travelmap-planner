import { useEffect, useMemo, useRef, useState } from 'react'
import { navigateTo } from '../lib/routes'
import { createId } from '../db/ids'
import {
  buildAiTripDraftDailyTipsNotes,
  convertAiTripDraftToImportData,
  validateAiTripDraft,
  summarizeAiTripDraft,
  type AiTripDraft,
  type AiTripDraftDay,
  type AiTripDraftItem,
  type AiDraftValidationError,
} from '../lib/ai/aiTripDraft'
import {
  type AiTripDraftRequest,
} from '../lib/ai/aiTripDraftRequest'
import { generateMockAiTripDraft } from '../lib/ai/aiTripDraftMock'
import {
  AI_TRIP_DRAFT_VARIANTS,
  buildAiTripDraftVariantComparisons,
  buildAiTripDraftVariantMixDays,
  buildAiTripDraftVariantRequest,
  buildDefaultAiTripDraftVariantMixSelection,
  buildMixedAiTripDraftFromVariants,
  createInitialAiTripDraftVariantStates,
  getSelectableAiTripDraftVariantDraft,
  getSuccessfulAiTripDraftVariantCount,
  mergeAiTripDraftVariantState,
  type AiTripDraftVariantKind,
  type AiTripDraftVariantState,
} from '../lib/ai/aiTripDraftVariants'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { getStoredAiPrivacySettings } from '../lib/ai/aiPrivacy'
import {
  sanitizeAiDraftRepairDraftForProxy,
  sanitizeAiDraftRepairFindingsForProxy,
  summarizeAiPrivacyForAiRequest,
} from '../lib/ai/aiPrivacyGuard'
import { analyzeAiTripDraftQuality } from '../lib/ai/aiTripDraftQuality'
import {
  flattenAiTripDraftQualityFindings,
  selectDefaultAiTripDraftQualityFindingIds,
  type AiTripDraftQualityCategory,
  type AiTripDraftQualityFinding,
} from '../lib/ai/aiTripDraftQuality'
import {
  applyAiTripDraftQualityRepairResultIfFresh,
  buildSelectedAiTripDraftRepairFindings,
} from '../lib/ai/aiTripDraftQualityRepair'
import {
  applyAiTripDraftRefineResultIfFresh,
  fingerprintAiTripDraft,
} from '../lib/ai/aiTripDraftRefine'
import {
  applyAiTripDraftPlaceLookupCandidateIfFresh,
  buildAiTripDraftMissingCoordinateLookupItems,
  buildAiTripDraftMapOrderAdjustment,
  buildAiTripDraftMapPreviews,
  formatAiTripDraftMapDistance,
  type AiTripDraftMissingCoordinateLookupItem,
} from '../lib/ai/aiTripDraftMapPreview'
import { buildAiTripDraftImportCheck } from '../lib/ai/aiTripDraftImportCheck'
import {
  fetchProviderProxyAiTripDraft,
  fetchProviderProxyAiTripDraftRefine,
  fetchProviderProxyAiTripDraftRepair,
  fetchProviderProxyPlaceLookup,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../lib/providerProxyClient'
import type {
  ProviderProxyAiTripDraftRequest,
  ProviderProxyAiTripDraftRefinePreferences,
  ProviderProxyAiTripDraftRefineScope,
  ProviderProxyPlaceLookupResult,
} from '../lib/ai/providerProxyContract'
import { PROVIDER_PROXY_PLACE_LOOKUP_OPERATION } from '../lib/ai/providerProxyContract'
import { isAutoSnapshotBackupEnabled } from '../lib/autoSnapshotBackup'
import { getRoutingConfig } from '../lib/routing'
import { importTripPlanRecords } from '../db'
import type { Trip, Day, ItineraryItem } from '../types'
import { useAiDraftRequestFormState } from './useAiDraftRequestFormState'

const QUALITY_CATEGORY_ORDER: AiTripDraftQualityCategory[] = [
  'time_conflict',
  'dense_schedule',
  'transport',
  'location',
  'duplicate_sight',
  'meal',
  'title_specificity',
]

export type DraftPlaceLookupState = {
  baselineFingerprint?: string
  error: string | null
  loading: boolean
  query: string
  results: ProviderProxyPlaceLookupResult[]
}

type PendingDraftPlaceLookupCandidate = {
  baselineFingerprint: string
  candidate: ProviderProxyPlaceLookupResult
  dayDate: string
  dayIndex: number
  itemIndex: number
  lookupKey: string
}

const SAMPLE_DRAFT = {
  title: '东京五日游',
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
  days: [
    {
      date: '2025-04-01',
      title: '抵达与浅草',
      tips: ['抵达日安排保持轻松，预留酒店入住和交通缓冲时间。'],
      items: [
        {
          title: '浅草寺',
          locationName: '浅草寺',
          address: '东京都台东区浅草2-3-1',
          lat: 35.7148,
          lng: 139.7967,
          startTime: '10:00',
          endTime: '12:00',
          note: '参观雷门和仲见世通',
        },
        {
          title: '东京晴空塔',
          locationName: '东京晴空塔',
          startTime: '14:00',
          endTime: '16:00',
          previousTransportMode: 'transit',
          previousTransportDurationMinutes: 25,
          previousTransportNote: '从浅草区域搭乘地铁或步行换乘前往晴空塔。',
        },
      ],
    },
    {
      date: '2025-04-02',
      title: '涩谷与原宿',
      tips: ['上午安排神社和公园，下午再进入涩谷/原宿商圈。'],
      items: [
        {
          title: '明治神宫',
          locationName: '明治神宫',
          lat: 35.6764,
          lng: 139.6993,
          startTime: '09:00',
        },
        {
          title: '涩谷十字路口',
          startTime: '14:00',
          previousTransportMode: 'transit',
          previousTransportDurationMinutes: 20,
          previousTransportNote: '可从原宿/明治神宫前站转乘到涩谷。',
        },
      ],
    },
  ],
}



export function useAiDraftController() {
  const profile = getStoredTravelProfile()
  const privacy = getStoredAiPrivacySettings()

  const [jsonText, setJsonText] = useState('')
  const [draft, setDraft] = useState<AiTripDraft | null>(null)
  const [errors, setErrors] = useState<AiDraftValidationError[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)

  const requestForm = useAiDraftRequestFormState({
    initialPace: profile.pace,
    initialTransport: profile.preferTransport,
  })
  const {
    requestAvoid,
    requestDayCount,
    requestDestination,
    requestEndDate,
    requestErrors,
    requestFreeText,
    requestInterestTags,
    requestInterestText,
    requestMustVisit,
    requestPace,
    requestPartySize,
    requestPreferTransport,
    requestStartDate,
    setRequestAvoid,
    setRequestDayCount,
    setRequestDestination,
    setRequestErrors,
    setRequestFreeText,
    setRequestInterestTags,
    setRequestInterestText,
    setRequestMustVisit,
    setRequestPace,
    setRequestPartySize,
    setRequestPreferTransport,
    setRequestStartDate,
    validateRequest,
  } = requestForm

  // Proxy state
  const proxyConfig = getProviderProxyConfig()
  const [proxyGenerating, setProxyGenerating] = useState(false)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [showProxyConfirm, setShowProxyConfirm] = useState(false)
  const [variantGenerating, setVariantGenerating] = useState(false)
  const [variantStates, setVariantStates] = useState<AiTripDraftVariantState[]>([])
  const variantComparisons = useMemo(
    () => buildAiTripDraftVariantComparisons(variantStates),
    [variantStates],
  )
  const variantMixDays = useMemo(
    () => buildAiTripDraftVariantMixDays(variantStates),
    [variantStates],
  )
  const defaultVariantMixSelection = useMemo(
    () => buildDefaultAiTripDraftVariantMixSelection(variantMixDays),
    [variantMixDays],
  )
  const [variantMixSelectionOverrides, setVariantMixSelectionOverrides] = useState<Record<string, AiTripDraftVariantKind>>({})
  const variantMixSelection = useMemo(() => {
    const selection = { ...defaultVariantMixSelection }
    for (const [date, kind] of Object.entries(variantMixSelectionOverrides)) {
      const day = variantMixDays.find((candidate) => candidate.date === date)
      if (day?.options.some((option) => option.kind === kind)) {
        selection[date] = kind
      }
    }
    return selection
  }, [defaultVariantMixSelection, variantMixDays, variantMixSelectionOverrides])
  const [variantMixError, setVariantMixError] = useState<string | null>(null)
  const [showVariantConfirm, setShowVariantConfirm] = useState(false)
  const [pendingVariantRetry, setPendingVariantRetry] = useState<AiTripDraftVariantKind | null>(null)
  const [generationOptionsOpen, setGenerationOptionsOpen] = useState(false)
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false)

  // Quality check state
  const qualityResult = useMemo(
    () => draft ? analyzeAiTripDraftQuality(draft, { pace: profile.pace, mealTimeProtection: profile.mealTimeProtection }) : null,
    [draft, profile.pace, profile.mealTimeProtection],
  )
  const qualityFindings = useMemo(
    () => qualityResult ? flattenAiTripDraftQualityFindings(qualityResult) : [],
    [qualityResult],
  )
  const qualityFindingGroups = useMemo(
    () => groupQualityFindingsByCategory(qualityFindings),
    [qualityFindings],
  )
  const defaultSelectedQualityFindingIds = useMemo(
    () => new Set(qualityResult ? selectDefaultAiTripDraftQualityFindingIds(qualityResult) : []),
    [qualityResult],
  )
  const qualityFindingIds = useMemo(
    () => new Set(qualityFindings.map((finding) => finding.id)),
    [qualityFindings],
  )
  const [qualitySelectionOverrides, setQualitySelectionOverrides] = useState<Record<string, boolean>>({})
  const selectedQualityFindingIds = useMemo(() => {
    const selected = new Set(defaultSelectedQualityFindingIds)
    for (const [id, enabled] of Object.entries(qualitySelectionOverrides)) {
      if (!qualityFindingIds.has(id)) continue
      if (enabled) {
        selected.add(id)
      } else {
        selected.delete(id)
      }
    }
    return selected
  }, [defaultSelectedQualityFindingIds, qualityFindingIds, qualitySelectionOverrides])
  const [repairGenerating, setRepairGenerating] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairSuccessMessage, setRepairSuccessMessage] = useState<string | null>(null)
  const [refineGenerating, setRefineGenerating] = useState(false)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [refineSuccessMessage, setRefineSuccessMessage] = useState<string | null>(null)
  const [pendingDayRefine, setPendingDayRefine] = useState<{ date: string; title?: string } | null>(null)
  const [dayRefineGuidance, setDayRefineGuidance] = useState('')
  const [showRangeRefineConfirm, setShowRangeRefineConfirm] = useState(false)
  const [rangeRefineStartDate, setRangeRefineStartDate] = useState('')
  const [rangeRefineEndDate, setRangeRefineEndDate] = useState('')
  const [rangeRefinePartySize, setRangeRefinePartySize] = useState(requestPartySize)
  const [rangeRefinePace, setRangeRefinePace] = useState(requestPace)
  const [rangeRefinePreferTransport, setRangeRefinePreferTransport] = useState(requestPreferTransport)
  const [rangeRefineInterestTags, setRangeRefineInterestTags] = useState<string[]>(requestInterestTags)
  const [rangeRefineInterestText, setRangeRefineInterestText] = useState(requestInterestText)
  const [rangeRefineMustVisit, setRangeRefineMustVisit] = useState(requestMustVisit)
  const [rangeRefineAvoid, setRangeRefineAvoid] = useState(requestAvoid)
  const [rangeRefineFreeText, setRangeRefineFreeText] = useState(requestFreeText)
  const [rangeRefineGuidance, setRangeRefineGuidance] = useState('')
  const [mapOrderMessage, setMapOrderMessage] = useState<{ date: string; message: string } | null>(null)
  const [draftPlaceLookups, setDraftPlaceLookups] = useState<Record<string, DraftPlaceLookupState>>({})
  const [pendingDraftPlaceCandidate, setPendingDraftPlaceCandidate] = useState<PendingDraftPlaceLookupCandidate | null>(null)
  const [draftPlaceLookupApplyError, setDraftPlaceLookupApplyError] = useState<string | null>(null)
  const draftRef = useRef<AiTripDraft | null>(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const draftDateOptions = useMemo(() => draft?.days.map((day) => day.date) ?? [], [draft])
  const mapPreviewDays = useMemo(() => draft ? buildAiTripDraftMapPreviews(draft) : [], [draft])
  const [activeMapPreviewDate, setActiveMapPreviewDate] = useState('')
  const activeMapPreview = useMemo(
    () => mapPreviewDays.find((day) => day.date === activeMapPreviewDate) ?? mapPreviewDays[0] ?? null,
    [activeMapPreviewDate, mapPreviewDays],
  )
  const activeMapPreviewDraftDay = useMemo(() => {
    if (!draft || !activeMapPreview) return null
    return draft.days[activeMapPreview.dayIndex] ?? null
  }, [activeMapPreview, draft])
  const activeMissingCoordinateLookupItems = useMemo(
    () => activeMapPreviewDraftDay
      ? buildAiTripDraftMissingCoordinateLookupItems(activeMapPreviewDraftDay, draft?.destination)
      : [],
    [activeMapPreviewDraftDay, draft?.destination],
  )
  const activeMapOrderAdjustment = useMemo(() => {
    if (!draft || !activeMapPreview) return null
    const day = draft.days.find((candidate) => candidate.date === activeMapPreview.date)
    return day ? buildAiTripDraftMapOrderAdjustment(day) : null
  }, [activeMapPreview, draft])
  const draftImportCheck = draft
    ? buildAiTripDraftImportCheck({
        autoSyncEnabled: isAutoSnapshotBackupEnabled(),
        draft,
        routingConfig: getRoutingConfig(),
      })
    : null

  function clearDraftPlaceLookupState() {
    setDraftPlaceLookups({})
    setPendingDraftPlaceCandidate(null)
    setDraftPlaceLookupApplyError(null)
  }

  function previewDraftObject(draftObj: unknown) {
    const text = JSON.stringify(draftObj, null, 2)
    clearDraftPlaceLookupState()
    setJsonText(text)
    setVariantStates([])
    setPendingVariantRetry(null)
    setVariantMixSelectionOverrides({})
    setVariantMixError(null)
    try {
      const result = validateAiTripDraft(draftObj)
      if (result.valid && result.draft) {
        setDraft(result.draft)
        setErrors([])
        setRequestSettingsOpen(false)
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: '草稿校验失败。' }])
    }
  }

  function handleLoadSample() {
    clearDraftPlaceLookupState()
    setJsonText(JSON.stringify(SAMPLE_DRAFT, null, 2))
    setDraft(null)
    setErrors([])
  }

  function handleParse() {
    try {
      const input = JSON.parse(jsonText)
      const result = validateAiTripDraft(input)
      clearDraftPlaceLookupState()
      if (result.valid && result.draft) {
        setDraft(result.draft)
        setErrors([])
        setRequestSettingsOpen(false)
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: 'JSON 格式无效，请检查语法。' }])
    }
  }

  function handleGenerateMock() {
    const request = validateCurrentDraftRequestForGeneration()
    if (!request) {
      setErrors([])
      setDraft(null)
      return
    }

    setRequestErrors([])
    const mockDraft = generateMockAiTripDraft(request)
    previewDraftObject(mockDraft)
    setGenerationOptionsOpen(false)
  }

  function handleProxyConfirm() {
    setShowProxyConfirm(false)
    handleGenerateViaProxy()
  }

  function handleVariantConfirm() {
    setShowVariantConfirm(false)
    setGenerationOptionsOpen(false)
    handleGenerateVariantsViaProxy()
  }

  function handleVariantRetryConfirm() {
    const kind = pendingVariantRetry
    setPendingVariantRetry(null)
    if (kind) {
      handleRegenerateVariantViaProxy(kind)
    }
  }

  function handleRepairConfirm() {
    setShowRepairConfirm(false)
    handleRepairViaProxy()
  }

  function openDayRefine(day: AiTripDraftDay) {
    setRefineError(null)
    setRefineSuccessMessage(null)
    setDayRefineGuidance('')
    setPendingDayRefine({ date: day.date, title: day.title })
  }

  function openRangeRefineConfirm() {
    if (!draft) return
    const startDate = rangeRefineStartDate || draft.days[0]?.date || draft.startDate
    const endDate = rangeRefineEndDate || draft.days[draft.days.length - 1]?.date || draft.endDate
    if (!startDate || !endDate || endDate < startDate) {
      setRefineError('请选择有效的优化日期范围。')
      return
    }
    setRangeRefineStartDate(startDate)
    setRangeRefineEndDate(endDate)
    setRefineError(null)
    setRefineSuccessMessage(null)
    setShowRangeRefineConfirm(true)
  }

  async function handleDayRefineConfirm() {
    const pending = pendingDayRefine
    if (!pending) return
    await runDraftRefine({
      guidance: dayRefineGuidance,
      scope: { date: pending.date, kind: 'day' },
      successMessage: `已重新生成 ${pending.date} 的草案内容。`,
    })
    setPendingDayRefine(null)
  }

  async function handleRangeRefineConfirm() {
    await runDraftRefine({
      guidance: rangeRefineGuidance,
      preferences: buildRangeRefinePreferences(),
      scope: {
        endDate: rangeRefineEndDate,
        kind: 'date_range',
        startDate: rangeRefineStartDate,
      },
      successMessage: `已重新生成 ${rangeRefineStartDate} 至 ${rangeRefineEndDate} 的草案内容。`,
    })
    setShowRangeRefineConfirm(false)
  }

  async function runDraftRefine({
    guidance,
    preferences,
    scope,
    successMessage,
  }: {
    guidance?: string
    preferences?: ProviderProxyAiTripDraftRefinePreferences
    scope: ProviderProxyAiTripDraftRefineScope
    successMessage: string
  }) {
    if (!proxyConfig.proxyUrl) {
      setRefineError('当前未配置 AI 行程优化服务。')
      return
    }
    const baselineDraft = draftRef.current
    if (!baselineDraft) {
      setRefineError('请先生成或解析一个行程草案。')
      return
    }

    const baselineFingerprint = fingerprintAiTripDraft(baselineDraft)
    setRefineError(null)
    setRefineSuccessMessage(null)
    setRefineGenerating(true)
    try {
      const result = await fetchProviderProxyAiTripDraftRefine(
        {
          draft: sanitizeAiDraftRepairDraftForProxy(baselineDraft, privacy),
          guidance: guidance?.trim() || undefined,
          operation: 'ai_trip_draft_refine',
          preferences,
          scope,
        },
        proxyConfig.proxyUrl,
      )

      const currentDraft = draftRef.current
      if (!currentDraft) {
        setRefineError('草案已变化，请重新生成。')
        return
      }

      const applied = applyAiTripDraftRefineResultIfFresh({
        baselineFingerprint,
        currentDraft,
        providerDraft: result.draft,
        scope,
      })
      if (!applied.ok) {
        setRefineError(applied.errors.join('\n'))
        return
      }

      previewDraftObject(applied.draft)
      setRefineSuccessMessage(result.warnings?.length
        ? `${successMessage} ${result.warnings.join(' ')}`
        : successMessage)
    } catch (caught) {
      if (caught instanceof ProviderProxyClientError) {
        setRefineError(caught.message)
      } else {
        setRefineError('AI 行程优化请求失败，请重试。')
      }
    } finally {
      setRefineGenerating(false)
    }
  }

  function buildRangeRefinePreferences(): ProviderProxyAiTripDraftRefinePreferences | undefined {
    const preferences: ProviderProxyAiTripDraftRefinePreferences = {}
    const partySize = Number(rangeRefinePartySize)
    if (Number.isInteger(partySize)) {
      preferences.partySize = partySize
    }
    if (rangeRefinePace) preferences.pace = rangeRefinePace
    if (rangeRefinePreferTransport) preferences.preferTransport = rangeRefinePreferTransport
    if (profile.mealTimeProtection !== undefined) preferences.mealTimeProtection = profile.mealTimeProtection
    if (rangeRefineInterestTags.length > 0) preferences.interestTags = rangeRefineInterestTags
    if (rangeRefineInterestText.trim()) preferences.interestText = rangeRefineInterestText.trim()
    if (rangeRefineMustVisit.trim()) preferences.mustVisitText = rangeRefineMustVisit.trim()
    if (rangeRefineAvoid.trim()) preferences.avoidText = rangeRefineAvoid.trim()
    if (rangeRefineFreeText.trim()) preferences.freeTextRequirement = rangeRefineFreeText.trim()
    return Object.values(preferences).some((value) => value !== undefined) ? preferences : undefined
  }

  async function handleRepairViaProxy() {
    if (!proxyConfig.proxyUrl || !draft) return
    if (!qualityResult) return

    const selectedFindings = buildSelectedAiTripDraftRepairFindings(qualityResult, selectedQualityFindingIds)
    if (selectedFindings.length === 0) {
      setRepairError('请先选择需要修复的问题。')
      return
    }

    setRepairError(null)
    setRepairSuccessMessage(null)
    setRepairGenerating(true)
    const baselineDraft = draftRef.current
    const baselineFingerprint = baselineDraft ? fingerprintAiTripDraft(baselineDraft) : ''
    try {
      const result = await fetchProviderProxyAiTripDraftRepair(
        {
          operation: 'ai_trip_draft_repair',
          draft: sanitizeAiDraftRepairDraftForProxy(baselineDraft ?? draft, privacy),
          qualityFindings: sanitizeAiDraftRepairFindingsForProxy(selectedFindings),
          repairInstruction: '只修复用户在方案质量检查中勾选的问题，未勾选的问题和无关内容保持不变。',
        },
        proxyConfig.proxyUrl,
      )

      const currentDraft = draftRef.current
      if (!baselineDraft || !currentDraft) {
        setRepairError('草案已变化，请重新检查后再修复。')
        return
      }

      const applied = applyAiTripDraftQualityRepairResultIfFresh({
        baselineFingerprint,
        currentDraft,
        repairedDraft: result.draft,
      })
      if (!applied.ok) {
        setRepairError(applied.errors.join('\n'))
        return
      }

      previewDraftObject(applied.draft)
      setRepairSuccessMessage(`已修复 ${selectedFindings.length} 个选中问题，请重新检查。`)
    } catch (caught) {
      if (caught instanceof ProviderProxyClientError) {
        setRepairError(caught.message)
      } else {
        setRepairError('修复请求失败，请重试。')
      }
    } finally {
      setRepairGenerating(false)
    }
  }

  function buildProxyAiTripDraftRequest(
    request: AiTripDraftRequest,
  ): ProviderProxyAiTripDraftRequest {
    return {
      dayCount: request.dayCount,
      destination: request.destination,
      endDate: request.endDate,
      freeTextRequirement: request.freeTextRequirement,
      interestTags: request.interestTags,
      interestText: request.interestText,
      mealTimeProtection: request.mealTimeProtection,
      mustVisitText: request.mustVisitText,
      avoidText: request.avoidText,
      operation: 'ai_trip_draft',
      partySize: request.partySize,
      pace: request.pace,
      preferTransport: request.preferTransport,
      startDate: request.startDate,
    }
  }

  function validateCurrentDraftRequestForGeneration() {
    const request = validateRequest(profile.mealTimeProtection)
    if (!request) {
      setErrors([])
      setDraft(null)
      return null
    }

    return request
  }

  async function generateVariantDraftViaProxy(
    baseRequest: AiTripDraftRequest,
    kind: AiTripDraftVariantKind,
  ): Promise<Partial<Omit<AiTripDraftVariantState, 'definition'>>> {
    if (!proxyConfig.proxyUrl) {
      return {
        error: '当前未配置 AI 生成服务。',
        status: 'error',
        warnings: [],
      }
    }

    const request = buildAiTripDraftVariantRequest(baseRequest, kind)
    try {
      const result = await fetchProviderProxyAiTripDraft(
        buildProxyAiTripDraftRequest(request),
        proxyConfig.proxyUrl,
      )
      const validation = validateAiTripDraft(result.draft)
      if (!validation.valid || !validation.draft) {
        return {
          error: validation.errors.map((error) => error.message).join('\n') || 'AI 返回的草案校验失败。',
          status: 'error',
          warnings: result.warnings ?? [],
        }
      }
      return {
        draft: validation.draft,
        error: undefined,
        status: 'success',
        warnings: result.warnings ?? [],
      }
    } catch (caught) {
      return {
        error: caught instanceof ProviderProxyClientError
          ? caught.message
          : 'AI 行程生成服务请求失败。',
        status: 'error',
        warnings: [],
      }
    }
  }

  async function handleGenerateVariantsViaProxy() {
    const request = validateCurrentDraftRequestForGeneration()
    if (!request) return

    setRequestErrors([])
    setProxyError(null)
    setErrors([])
    setDraft(null)
    setVariantMixError(null)
    setVariantGenerating(true)
    setVariantStates(createInitialAiTripDraftVariantStates().map((state) => ({
      ...state,
      status: 'loading',
    })))

    try {
      const results = await Promise.all(
        AI_TRIP_DRAFT_VARIANTS.map(async (variant) => ({
          kind: variant.kind,
          patch: await generateVariantDraftViaProxy(request, variant.kind),
        })),
      )
      const nextStates = results.reduce(
        (states, result) => mergeAiTripDraftVariantState(states, result.kind, result.patch),
        createInitialAiTripDraftVariantStates(),
      )
      setVariantStates(nextStates)
      if (getSuccessfulAiTripDraftVariantCount(nextStates) === 0) {
        setProxyError('三种方案都生成失败，请稍后重试。')
      }
    } finally {
      setVariantGenerating(false)
    }
  }

  async function handleRegenerateVariantViaProxy(kind: AiTripDraftVariantKind) {
    const request = validateCurrentDraftRequestForGeneration()
    if (!request) return

    setRequestErrors([])
    setProxyError(null)
    setVariantMixError(null)
    setVariantGenerating(true)
    setVariantStates((current) => mergeAiTripDraftVariantState(
      current.length > 0 ? current : createInitialAiTripDraftVariantStates(),
      kind,
      {
        draft: undefined,
        error: undefined,
        status: 'loading',
        warnings: [],
      },
    ))

    const patch = await generateVariantDraftViaProxy(request, kind)
    setVariantStates((current) => mergeAiTripDraftVariantState(
      current.length > 0 ? current : createInitialAiTripDraftVariantStates(),
      kind,
      patch,
    ))
    setVariantGenerating(false)
  }

  function handleSelectVariantDraft(state: AiTripDraftVariantState) {
    const selectedDraft = getSelectableAiTripDraftVariantDraft(state)
    if (!selectedDraft) return
    setProxyError(null)
    previewDraftObject(selectedDraft)
  }

  function updateVariantMixSelection(date: string, kind: AiTripDraftVariantKind) {
    setVariantMixError(null)
    setVariantMixSelectionOverrides((current) => ({
      ...current,
      [date]: kind,
    }))
  }

  function handleBuildMixedVariantDraft() {
    const result = buildMixedAiTripDraftFromVariants({
      selection: variantMixSelection,
      states: variantStates,
    })
    if (!result.ok) {
      setVariantMixError(result.errors.join('\n'))
      return
    }
    setProxyError(null)
    setVariantMixError(null)
    previewDraftObject(result.draft)
  }

  async function handleGenerateViaProxy() {
    if (!proxyConfig.proxyUrl) return

    const request = validateCurrentDraftRequestForGeneration()
    if (!request) return

    setRequestErrors([])
    setProxyError(null)
    setVariantStates([])
    setVariantMixError(null)
    setProxyGenerating(true)
    try {
      const result = await fetchProviderProxyAiTripDraft(
        buildProxyAiTripDraftRequest(request),
        proxyConfig.proxyUrl,
      )
      previewDraftObject(result.draft)
    } catch (caught) {
      const message = caught instanceof ProviderProxyClientError
        ? caught.message
        : 'AI 行程生成服务请求失败。'
      setProxyError(message)
      setDraft(null)
    } finally {
      setProxyGenerating(false)
    }
  }

  async function handleConfirmImport() {
    if (!draft) return
    setImporting(true)
    try {
      const now = Date.now()
      const tripId = createId('trip')
      const importData = convertAiTripDraftToImportData(draft)
      const dailyTipsNotes = buildAiTripDraftDailyTipsNotes(draft)

      const trip: Trip = {
        id: tripId,
        title: importData.trip.title,
        destination: importData.trip.destination,
        startDate: importData.trip.startDate,
        endDate: importData.trip.endDate,
        timeZone: importData.trip.timeZone,
        timeZoneSource: importData.trip.timeZone ? 'imported' : undefined,
        notes: dailyTipsNotes,
        createdAt: now,
        updatedAt: now,
      }

      const days: Day[] = []
      const itineraryItems: ItineraryItem[] = []

      importData.days.forEach((day, dayIndex) => {
        const dayId = createId('day')
        days.push({
          id: dayId,
          tripId,
          date: day.date,
          title: day.title ?? `第 ${dayIndex + 1} 天`,
          timeZone: day.timeZone,
          timeZoneSource: day.timeZone ? 'imported' : undefined,
          sortOrder: dayIndex,
        })

        day.items.forEach((item, itemIndex) => {
          itineraryItems.push({
            id: createId('item'),
            tripId,
            dayId,
            title: item.title,
            startTime: item.startTime,
            endTime: item.endTime,
            startTimeZone: item.startTimeZone,
            endDate: item.endDate,
            endTimeZone: item.endTimeZone,
            locationName: item.locationName,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            previousTransportMode: item.previousTransportMode,
            previousTransportDurationMinutes: item.previousTransportDurationMinutes,
            previousTransportNote: item.previousTransportNote,
            notes: item.notes,
            ticketIds: [],
            sortOrder: itemIndex,
            createdAt: now,
            updatedAt: now,
          })
        })
      })

      const result = await importTripPlanRecords({
        trip,
        days,
        itineraryItems,
        ticketMetas: [],
        ticketBlobs: [],
      })
      navigateTo('trip', { postImportRoutePrompt: '1', tripId: result.tripId })
    } catch (error) {
      setErrors([{ path: 'root', message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}` }])
      setShowConfirm(false)
    } finally {
      setImporting(false)
    }
  }

  const summary = draft ? summarizeAiTripDraft(draft) : null
  const repairPrivacyNotice = draft ? summarizeAiPrivacyForAiRequest(privacy, 'repair') : null
  const canImportDraft = Boolean(draft && errors.length === 0 && !refineGenerating)
  const repairableQualityFindings = qualityFindings.filter((finding) => finding.repairable)
  const selectedQualityRepairCount = repairableQualityFindings.filter((finding) => selectedQualityFindingIds.has(finding.id)).length

  function applyDraftEdit(nextDraft: AiTripDraft) {
    setMapOrderMessage(null)
    clearDraftPlaceLookupState()
    setJsonText(JSON.stringify(nextDraft, null, 2))
    const validation = validateAiTripDraft(nextDraft)
    if (validation.valid && validation.draft) {
      setDraft(validation.draft)
      setErrors([])
    } else {
      setDraft(nextDraft)
      setErrors(validation.errors)
    }
  }

  function updateDraftRoot(patch: Partial<Pick<AiTripDraft, 'destination' | 'endDate' | 'startDate' | 'title'>>) {
    if (!draft) return
    applyDraftEdit({ ...draft, ...patch })
  }

  function updateDraftDay(dayIndex: number, patch: Partial<AiTripDraftDay>) {
    if (!draft) return
    applyDraftEdit({
      ...draft,
      days: draft.days.map((day, index) => index === dayIndex ? { ...day, ...patch } : day),
    })
  }

  function updateDraftDayTip(dayIndex: number, tipIndex: number, value: string) {
    const day = draft?.days[dayIndex]
    if (!day) return
    const tips = [...(day.tips ?? [])]
    tips[tipIndex] = value
    updateDraftDay(dayIndex, { tips })
  }

  function addDraftDayTip(dayIndex: number) {
    const day = draft?.days[dayIndex]
    if (!day) return
    updateDraftDay(dayIndex, { tips: [...(day.tips ?? []), ''] })
  }

  function removeDraftDayTip(dayIndex: number, tipIndex: number) {
    const day = draft?.days[dayIndex]
    if (!day) return
    updateDraftDay(dayIndex, { tips: (day.tips ?? []).filter((_, index) => index !== tipIndex) })
  }

  function updateDraftItem(dayIndex: number, itemIndex: number, patch: Partial<AiTripDraftItem>) {
    const day = draft?.days[dayIndex]
    if (!day) return
    updateDraftDay(dayIndex, {
      items: day.items.map((item, index) => index === itemIndex ? { ...item, ...patch } : item),
    })
  }

  function addDraftItem(dayIndex: number) {
    const day = draft?.days[dayIndex]
    if (!day) return
    const nextItem: AiTripDraftItem = {
      title: '新的行程点',
      previousTransportMode: day.items.length > 0 ? 'walk' : undefined,
    }
    updateDraftDay(dayIndex, { items: [...day.items, nextItem] })
  }

  function removeDraftItem(dayIndex: number, itemIndex: number) {
    const day = draft?.days[dayIndex]
    if (!day) return
    updateDraftDay(dayIndex, { items: day.items.filter((_, index) => index !== itemIndex) })
  }

  function moveDraftItem(dayIndex: number, itemIndex: number, direction: -1 | 1) {
    const day = draft?.days[dayIndex]
    if (!day) return
    const nextIndex = itemIndex + direction
    if (nextIndex < 0 || nextIndex >= day.items.length) return
    const items = [...day.items]
    const [item] = items.splice(itemIndex, 1)
    items.splice(nextIndex, 0, item)
    updateDraftDay(dayIndex, { items })
  }

  function applyActiveMapOrderAdjustment() {
    if (!draft || !activeMapPreview || !activeMapOrderAdjustment) return
    const dayIndex = draft.days.findIndex((day) => day.date === activeMapPreview.date)
    if (dayIndex < 0) return
    if (!activeMapOrderAdjustment.changed) {
      setMapOrderMessage({
        date: activeMapPreview.date,
        message: activeMapOrderAdjustment.reason,
      })
      return
    }

    applyDraftEdit({
      ...draft,
      days: draft.days.map((day, index) => index === dayIndex
        ? { ...day, items: activeMapOrderAdjustment.nextItems }
        : day),
    })
    setMapOrderMessage({
      date: activeMapPreview.date,
      message: `已按地图直线顺序重排本日行程，直线距离约从 ${formatAiTripDraftMapDistance(activeMapOrderAdjustment.beforeDistanceMeters)} 调整为 ${formatAiTripDraftMapDistance(activeMapOrderAdjustment.afterDistanceMeters)}。`,
    })
  }

  async function searchDraftPlaceCandidates(lookupItem: AiTripDraftMissingCoordinateLookupItem) {
    const config = getProviderProxyConfig()
    const query = lookupItem.query.trim()
    if (!query) {
      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          error: '缺少可查询的地点名称或地址。',
          loading: false,
          query,
          results: [],
        },
      }))
      return
    }
    if (!config.proxyUrl) {
      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          error: '当前未配置地点查询服务。',
          loading: false,
          query,
          results: [],
        },
      }))
      return
    }

    const baselineDraft = draftRef.current
    if (!baselineDraft || !activeMapPreview) {
      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          error: '请先生成或解析一个行程草案。',
          loading: false,
          query,
          results: [],
        },
      }))
      return
    }
    const day = baselineDraft.days[activeMapPreview.dayIndex]
    if (!day || day.date !== activeMapPreview.date || !day.items[lookupItem.itemIndex]) {
      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          error: '当前日期或行程点已变化，请重新选择。',
          loading: false,
          query,
          results: [],
        },
      }))
      return
    }

    const baselineFingerprint = fingerprintAiTripDraft(baselineDraft)
    setDraftPlaceLookupApplyError(null)
    setDraftPlaceLookups((current) => ({
      ...current,
      [lookupItem.lookupKey]: {
        baselineFingerprint,
        error: null,
        loading: true,
        query,
        results: [],
      },
    }))

    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query,
        requestId: `draft-place-${activeMapPreview.date}-${lookupItem.itemIndex + 1}`,
      }, config.proxyUrl)

      const currentDraft = draftRef.current
      if (!currentDraft || fingerprintAiTripDraft(currentDraft) !== baselineFingerprint) {
        setDraftPlaceLookups((current) => ({
          ...current,
          [lookupItem.lookupKey]: {
            baselineFingerprint,
            error: '草案已变化，请重新查找。',
            loading: false,
            query,
            results: [],
          },
        }))
        return
      }

      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          baselineFingerprint,
          error: response.results.length === 0 ? '没有找到可用候选地点。' : null,
          loading: false,
          query,
          results: response.results,
        },
      }))
    } catch (caught) {
      setDraftPlaceLookups((current) => ({
        ...current,
        [lookupItem.lookupKey]: {
          baselineFingerprint,
          error: caught instanceof ProviderProxyClientError ? caught.message : '地点查询失败，请稍后再试。',
          loading: false,
          query,
          results: [],
        },
      }))
    }
  }

  function openDraftPlaceCandidate(
    lookupItem: AiTripDraftMissingCoordinateLookupItem,
    candidate: ProviderProxyPlaceLookupResult,
  ) {
    if (!activeMapPreview) return
    const state = draftPlaceLookups[lookupItem.lookupKey]
    const baselineDraft = draftRef.current
    const baselineFingerprint = state?.baselineFingerprint ?? (baselineDraft ? fingerprintAiTripDraft(baselineDraft) : '')
    if (!baselineFingerprint) {
      setDraftPlaceLookupApplyError('草案已变化，请重新查找。')
      return
    }
    setDraftPlaceLookupApplyError(null)
    setPendingDraftPlaceCandidate({
      baselineFingerprint,
      candidate,
      dayDate: activeMapPreview.date,
      dayIndex: activeMapPreview.dayIndex,
      itemIndex: lookupItem.itemIndex,
      lookupKey: lookupItem.lookupKey,
    })
  }

  function confirmApplyDraftPlaceCandidate() {
    if (!pendingDraftPlaceCandidate) return
    const currentDraft = draftRef.current
    if (!currentDraft) {
      setPendingDraftPlaceCandidate(null)
      setDraftPlaceLookupApplyError('草案已变化，请重新查找。')
      return
    }

    const applied = applyAiTripDraftPlaceLookupCandidateIfFresh({
      baselineFingerprint: pendingDraftPlaceCandidate.baselineFingerprint,
      candidate: pendingDraftPlaceCandidate.candidate,
      currentDraft,
      currentFingerprint: fingerprintAiTripDraft(currentDraft),
      dayDate: pendingDraftPlaceCandidate.dayDate,
      dayIndex: pendingDraftPlaceCandidate.dayIndex,
      itemIndex: pendingDraftPlaceCandidate.itemIndex,
    })
    if (!applied.ok) {
      setPendingDraftPlaceCandidate(null)
      setDraftPlaceLookupApplyError(applied.error)
      setDraftPlaceLookups((current) => ({
        ...current,
        [pendingDraftPlaceCandidate.lookupKey]: {
          ...(current[pendingDraftPlaceCandidate.lookupKey] ?? {
            loading: false,
            query: '',
            results: [],
          }),
          error: applied.error,
          loading: false,
        },
      }))
      return
    }

    setPendingDraftPlaceCandidate(null)
    applyDraftEdit(applied.draft)
  }

  function toggleQualityFinding(id: string) {
    setQualitySelectionOverrides((current) => ({
      ...current,
      [id]: !selectedQualityFindingIds.has(id),
    }))
  }

  function selectAllRepairableQualityFindings() {
    setQualitySelectionOverrides((current) => ({
      ...current,
      ...Object.fromEntries(repairableQualityFindings.map((finding) => [finding.id, true])),
    }))
  }

  function clearSelectedQualityFindings() {
    setQualitySelectionOverrides((current) => ({
      ...current,
      ...Object.fromEntries(repairableQualityFindings.map((finding) => [finding.id, false])),
    }))
  }

  return {
    activeMapOrderAdjustment,
    activeMapPreview,
    activeMissingCoordinateLookupItems,
    addDraftDayTip,
    addDraftItem,
    applyActiveMapOrderAdjustment,
    canImportDraft,
    clearSelectedQualityFindings,
    confirmApplyDraftPlaceCandidate,
    dayRefineGuidance,
    draft,
    draftDateOptions,
    draftImportCheck,
    draftPlaceLookupApplyError,
    draftPlaceLookups,
    errors,
    generationOptionsOpen,
    handleBuildMixedVariantDraft,
    handleConfirmImport,
    handleDayRefineConfirm,
    handleGenerateMock,
    handleLoadSample,
    handleParse,
    handleProxyConfirm,
    handleRangeRefineConfirm,
    handleRepairConfirm,
    handleSelectVariantDraft,
    handleVariantConfirm,
    handleVariantRetryConfirm,
    importing,
    jsonText,
    mapOrderMessage,
    mapPreviewDays,
    moveDraftItem,
    openDayRefine,
    openDraftPlaceCandidate,
    openRangeRefineConfirm,
    pendingDayRefine,
    pendingDraftPlaceCandidate,
    pendingVariantRetry,
    proxyConfig,
    proxyError,
    proxyGenerating,
    qualityFindingGroups,
    qualityFindings,
    qualityResult,
    rangeRefineAvoid,
    rangeRefineEndDate,
    rangeRefineFreeText,
    rangeRefineGuidance,
    rangeRefineInterestTags,
    rangeRefineInterestText,
    rangeRefineMustVisit,
    rangeRefinePace,
    rangeRefinePartySize,
    rangeRefinePreferTransport,
    rangeRefineStartDate,
    refineError,
    refineGenerating,
    refineSuccessMessage,
    removeDraftDayTip,
    removeDraftItem,
    repairError,
    repairGenerating,
    repairPrivacyNotice,
    repairSuccessMessage,
    repairableQualityFindings,
    requestAvoid,
    requestDayCount,
    requestDestination,
    requestEndDate,
    requestErrors,
    requestFreeText,
    requestInterestTags,
    requestInterestText,
    requestMustVisit,
    requestPace,
    requestPartySize,
    requestPreferTransport,
    requestSettingsOpen,
    requestStartDate,
    searchDraftPlaceCandidates,
    selectAllRepairableQualityFindings,
    selectedQualityFindingIds,
    selectedQualityRepairCount,
    setActiveMapPreviewDate,
    setDayRefineGuidance,
    setGenerationOptionsOpen,
    setJsonText,
    setPendingDayRefine,
    setPendingDraftPlaceCandidate,
    setPendingVariantRetry,
    setRangeRefineAvoid,
    setRangeRefineEndDate,
    setRangeRefineFreeText,
    setRangeRefineGuidance,
    setRangeRefineInterestTags,
    setRangeRefineInterestText,
    setRangeRefineMustVisit,
    setRangeRefinePace,
    setRangeRefinePartySize,
    setRangeRefinePreferTransport,
    setRangeRefineStartDate,
    setRequestAvoid,
    setRequestDayCount,
    setRequestDestination,
    setRequestFreeText,
    setRequestInterestTags,
    setRequestInterestText,
    setRequestMustVisit,
    setRequestPace,
    setRequestPartySize,
    setRequestPreferTransport,
    setRequestSettingsOpen,
    setRequestStartDate,
    setShowConfirm,
    setShowProxyConfirm,
    setShowRangeRefineConfirm,
    setShowRepairConfirm,
    setShowVariantConfirm,
    showConfirm,
    showProxyConfirm,
    showRangeRefineConfirm,
    showRepairConfirm,
    showVariantConfirm,
    summary,
    toggleQualityFinding,
    updateDraftDay,
    updateDraftDayTip,
    updateDraftItem,
    updateDraftRoot,
    updateVariantMixSelection,
    variantComparisons,
    variantGenerating,
    variantMixDays,
    variantMixError,
    variantMixSelection,
    variantStates,
  }
}

export type AiDraftController = ReturnType<typeof useAiDraftController>

function groupQualityFindingsByCategory(findings: AiTripDraftQualityFinding[]) {
  return QUALITY_CATEGORY_ORDER
    .map((category) => ({
      category,
      findings: findings.filter((finding) => finding.category === category),
    }))
    .filter((group) => group.findings.length > 0)
}
