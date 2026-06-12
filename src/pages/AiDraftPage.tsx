import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, MapPinned, Search } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Collapsible } from '../components/ui/Collapsible'
import { FormField, FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS } from '../components/ui/FormField'
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
  buildAiTripDraftRequest,
  calculateEndDateFromDayCount,
  validateAiTripDraftRequest,
  type AiTripDraftRequest,
  type AiTripDraftRequestValidationError,
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
  summarizeAiTripDraftVariantDraft,
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
  AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS,
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
  type AiTripDraftMapOrderAdjustmentResult,
  type AiTripDraftMapPreviewDay,
} from '../lib/ai/aiTripDraftMapPreview'
import {
  buildAiTripDraftImportCheck,
  type AiTripDraftImportCheck,
} from '../lib/ai/aiTripDraftImportCheck'
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
import type { Trip, Day, ItineraryItem, TransportMode } from '../types'

const INTEREST_TAGS = ['亲子', '美食', '历史文化', '自然风景', '购物', '博物馆', '夜景', '轻徒步', '摄影', '温泉']
const DEFAULT_DAY_COUNT = '3'
const DEFAULT_PARTY_SIZE = '2'
const QUALITY_CATEGORY_ORDER: AiTripDraftQualityCategory[] = [
  'time_conflict',
  'dense_schedule',
  'transport',
  'location',
  'duplicate_sight',
  'meal',
  'title_specificity',
]

type DraftPlaceLookupState = {
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

export function AiDraftPage() {
  const profile = getStoredTravelProfile()
  const privacy = getStoredAiPrivacySettings()

  const [jsonText, setJsonText] = useState('')
  const [draft, setDraft] = useState<AiTripDraft | null>(null)
  const [errors, setErrors] = useState<AiDraftValidationError[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)

  // Request form state
  const [requestDestination, setRequestDestination] = useState('')
  const [requestStartDate, setRequestStartDate] = useState('')
  const [requestDayCount, setRequestDayCount] = useState(DEFAULT_DAY_COUNT)
  const [requestPartySize, setRequestPartySize] = useState(DEFAULT_PARTY_SIZE)
  const [requestPace, setRequestPace] = useState(profile.pace)
  const [requestPreferTransport, setRequestPreferTransport] = useState(profile.preferTransport)
  const [requestInterestTags, setRequestInterestTags] = useState<string[]>([])
  const [requestInterestText, setRequestInterestText] = useState('')
  const [requestMustVisit, setRequestMustVisit] = useState('')
  const [requestAvoid, setRequestAvoid] = useState('')
  const [requestFreeText, setRequestFreeText] = useState('')
  const [requestErrors, setRequestErrors] = useState<AiTripDraftRequestValidationError[]>([])

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
  const requestEndDate = useMemo(
    () => calculateEndDateFromDayCount(requestStartDate, Number(requestDayCount)),
    [requestDayCount, requestStartDate],
  )
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
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: 'JSON 格式无效，请检查语法。' }])
    }
  }

  function buildCurrentDraftRequestInput() {
    return {
      destination: requestDestination,
      startDate: requestStartDate,
      dayCount: requestDayCount,
      endDate: requestEndDate,
      partySize: requestPartySize,
      interestTags: requestInterestTags,
      interestText: requestInterestText,
      pace: requestPace,
      preferTransport: requestPreferTransport,
      mealTimeProtection: profile.mealTimeProtection,
      mustVisitText: requestMustVisit,
      avoidText: requestAvoid,
      freeTextRequirement: requestFreeText,
    }
  }

  function handleGenerateMock() {
    const built = buildAiTripDraftRequest(
      buildCurrentDraftRequestInput(),
      { pace: profile.pace, preferTransport: profile.preferTransport },
    )

    const validation = validateAiTripDraftRequest(built)
    if (!validation.valid || !validation.request) {
      setRequestErrors(validation.errors)
      setErrors([])
      setDraft(null)
      return
    }

    setRequestErrors([])
    const mockDraft = generateMockAiTripDraft(validation.request)
    previewDraftObject(mockDraft)
  }

  function handleProxyConfirm() {
    setShowProxyConfirm(false)
    handleGenerateViaProxy()
  }

  function handleVariantConfirm() {
    setShowVariantConfirm(false)
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
    const built = buildAiTripDraftRequest(
      buildCurrentDraftRequestInput(),
      { pace: profile.pace, preferTransport: profile.preferTransport },
    )

    const validation = validateAiTripDraftRequest(built)
    if (!validation.valid || !validation.request) {
      setRequestErrors(validation.errors)
      setErrors([])
      setDraft(null)
      return null
    }

    return validation.request
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

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div className="space-y-1" data-testid="ai-draft-page-header">
        <h1 className="text-xl font-bold text-on-surface dark:text-on-surface">AI 生成行程</h1>
        <p className="text-sm leading-6 tm-muted">
          填写旅行偏好，生成可预览、可修改、可确认导入的完整行程草案
        </p>
        <p className="text-xs tm-muted">
          生成草案不会写入本地旅行；确认导入后才会创建行程
        </p>
      </div>

      <div className="space-y-3" data-testid="ai-draft-request-form">
        <p className="text-sm font-semibold text-on-surface dark:text-on-surface">填写行程信息</p>

        <FormField
          label="目的地"
          value={requestDestination}
          onChange={setRequestDestination}
          placeholder="例如：东京、巴黎、曼谷"
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="开始日期"
            value={requestStartDate}
            onChange={setRequestStartDate}
            type="date"
            required
          />
          <FormField
            label="天数"
            value={requestDayCount}
            onChange={setRequestDayCount}
            type="number"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="同行人数"
            value={requestPartySize}
            onChange={setRequestPartySize}
            type="number"
            required
          />
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>结束日期</span>
            <input
              className={FIELD_INPUT_CLASS}
              readOnly
              value={requestEndDate || '选择日期和天数后计算'}
            />
          </label>
        </div>
        <div className="space-y-2">
          <span className={FIELD_LABEL_CLASS}>兴趣标签</span>
          <div className="flex flex-wrap gap-2" data-testid="ai-trip-builder-interest-tags">
            {INTEREST_TAGS.map((tag) => {
              const selected = requestInterestTags.includes(tag)
              return (
                <button
                  className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
                    selected
                      ? 'border-primary/40 bg-primary-container text-on-primary-container'
                      : 'border-outline-variant/30 bg-surface-container text-on-surface-variant'
                  }`}
                  key={tag}
                  onClick={() => setRequestInterestTags((current) =>
                    current.includes(tag)
                      ? current.filter((item) => item !== tag)
                      : [...current, tag],
                  )}
                  type="button"
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>兴趣偏好</span>
          <textarea
            className={`${FIELD_TEXTAREA_CLASS} h-20`}
            placeholder="例如：咖啡馆、建筑、适合拍照、少排队"
            value={requestInterestText}
            onChange={(e) => setRequestInterestText(e.target.value)}
          />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>旅行节奏</span>
          <select
            className={FIELD_SELECT_CLASS}
            value={requestPace}
            onChange={(e) => setRequestPace(e.target.value as typeof requestPace)}
          >
            <option value="relaxed">轻松</option>
            <option value="moderate">适中</option>
            <option value="compact">紧凑</option>
          </select>
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>交通偏好</span>
          <select
            className={FIELD_SELECT_CLASS}
            value={requestPreferTransport}
            onChange={(e) => setRequestPreferTransport(e.target.value as typeof requestPreferTransport)}
          >
            <option value="public_transport">公共交通</option>
            <option value="walking">步行</option>
            <option value="taxi">打车</option>
            <option value="mixed">综合</option>
          </select>
        </label>

        <Collapsible title="更多偏好（可选）" subtitle="想去的地方、不想要的安排、补充要求">
          <div className="space-y-3">
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>想去的地方</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：浅草寺、秋叶原"
                value={requestMustVisit}
                onChange={(e) => setRequestMustVisit(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>不想要的安排</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：不要购物商场"
                value={requestAvoid}
                onChange={(e) => setRequestAvoid(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>补充要求</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：带老人出行，节奏放慢"
                value={requestFreeText}
                onChange={(e) => setRequestFreeText(e.target.value)}
              />
            </label>
          </div>
        </Collapsible>

        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            生成完整行程会通过旅图服务请求 AI；生成前会先确认，生成结果只进入草案。
            <br />
            生成后仍需预览和确认，确认导入后才会创建本地旅行。
            {proxyConfig.configured && (
              <>
                <br />
                请求将包含目的地、日期和偏好信息，不会包含票据内容；本地示例草案不会调用外部 AI。
              </>
            )}
          </p>
        </Card>

        {requestErrors.length > 0 && (
          <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
            <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">表单错误</h3>
            <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
              {requestErrors.map((error, i) => (
                <li key={i}>{error.message}</li>
              ))}
            </ul>
          </Card>
        )}

        {proxyConfig.configured ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => setShowVariantConfirm(true)}
              className="w-full"
              data-testid="ai-draft-generate-variants-action"
              disabled={proxyGenerating}
              loading={variantGenerating}
            >
              生成三种方案
            </Button>
            <Button
              onClick={() => setShowProxyConfirm(true)}
              className="w-full"
              disabled={variantGenerating}
              loading={proxyGenerating}
              variant="secondary"
            >
              生成完整行程
            </Button>
          </div>
        ) : (
          <Button disabled className="w-full" variant="secondary">
            当前未配置 AI 生成服务
          </Button>
        )}

        <Button onClick={handleGenerateMock} className="w-full" variant="secondary">
          生成本地示例草案
        </Button>

        {proxyError && (
          <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
            <p className="text-sm text-red-700 dark:text-red-300">{proxyError}</p>
          </Card>
        )}

        {variantStates.length > 0 && (
          <Card className="space-y-3" data-testid="ai-draft-variant-panel">
            <div className="space-y-1">
              <h3 className="font-medium text-on-surface dark:text-on-surface">多方案草案</h3>
              <p className="text-sm tm-muted">
                选择一个方案后会进入编辑和方案质量检查，其他方案会被丢弃。
              </p>
            </div>
            <AiDraftVariantComparisonPanel
              comparisons={variantComparisons}
              disabled={variantGenerating || proxyGenerating}
              mixDays={variantMixDays}
              mixError={variantMixError}
              mixSelection={variantMixSelection}
              onBuildMix={handleBuildMixedVariantDraft}
              onMixSelectionChange={updateVariantMixSelection}
            />
            <div className="space-y-3">
              {variantStates.map((state) => (
                <AiDraftVariantCard
                  key={state.definition.kind}
                  state={state}
                  disabled={variantGenerating || proxyGenerating}
                  onRetry={() => setPendingVariantRetry(state.definition.kind)}
                  onSelect={() => handleSelectVariantDraft(state)}
                />
              ))}
            </div>
          </Card>
        )}
      </div>

      <div data-testid="ai-draft-json-section">
        <Collapsible title="粘贴 JSON 草稿" subtitle="如果你已经有符合格式的草稿 JSON，可以在这里粘贴。">
          <div className="space-y-4">
            <div className="space-y-2">
              <textarea
                className="h-48 w-full rounded-xl border border-outline-variant/30 p-3 font-mono text-sm tm-surface dark:border-outline-variant/30"
                placeholder='{"title": "...", "startDate": "YYYY-MM-DD", ...}'
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleLoadSample} variant="secondary">
                加载固定示例
              </Button>
              <Button onClick={handleParse} disabled={!jsonText.trim()}>
                解析草稿
              </Button>
            </div>
          </div>
        </Collapsible>
      </div>

      {errors.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30" data-testid="ai-draft-errors">
          <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">草稿错误</h3>
          <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
            {errors.map((error, i) => (
              <li key={i}>
                {error.path !== 'root' && <span className="font-mono text-xs">{error.path}: </span>}
                {error.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary && (
        <>
          <Card className="space-y-3" data-testid="ai-draft-summary">
            <h3 className="font-medium text-on-surface dark:text-on-surface">草稿摘要</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="tm-muted">旅行标题</dt>
              <dd className="font-medium">{summary.title}</dd>
              <dt className="tm-muted">目的地</dt>
              <dd>{summary.destination || '未指定'}</dd>
              <dt className="tm-muted">日期范围</dt>
              <dd>{summary.startDate} 至 {summary.endDate}</dd>
              <dt className="tm-muted">天数</dt>
              <dd>{summary.daysCount} 天</dd>
              <dt className="tm-muted">行程点</dt>
              <dd>{summary.itemsCount} 个</dd>
            </dl>
          </Card>

          <AiDraftMapPreviewCard
            activePreview={activeMapPreview}
            adjustment={activeMapOrderAdjustment}
            applyError={draftPlaceLookupApplyError}
            missingCoordinateItems={activeMissingCoordinateLookupItems}
            orderMessage={mapOrderMessage?.date === activeMapPreview?.date ? mapOrderMessage.message : null}
            onActiveDateChange={setActiveMapPreviewDate}
            onApplyMapOrder={applyActiveMapOrderAdjustment}
            onSearchMissingCoordinate={(lookupItem) => void searchDraftPlaceCandidates(lookupItem)}
            onSelectPlaceCandidate={openDraftPlaceCandidate}
            placeLookupConfigured={Boolean(getProviderProxyConfig().proxyUrl)}
            placeLookups={draftPlaceLookups}
            previews={mapPreviewDays}
          />

          <Card className="space-y-3" data-testid="ai-draft-quality-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-on-surface dark:text-on-surface">方案质量检查</h3>
                <p className="text-sm tm-muted">{qualityResult?.summary.message ?? '未发现明显问题。'}</p>
              </div>
              {repairableQualityFindings.length > 0 && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    className="min-h-11 px-3 text-xs"
                    data-testid="ai-draft-quality-select-all"
                    onClick={selectAllRepairableQualityFindings}
                    variant="ghost"
                  >
                    全选
                  </Button>
                  <Button
                    className="min-h-11 px-3 text-xs"
                    data-testid="ai-draft-quality-clear-selection"
                    onClick={clearSelectedQualityFindings}
                    variant="ghost"
                  >
                    取消
                  </Button>
                </div>
              )}
            </div>

            {qualityFindings.length === 0 && (
              <p className="text-sm text-green-700 dark:text-green-300">未发现明显问题。</p>
            )}

            {qualityFindingGroups.length > 0 && (
              <div className="space-y-3" data-testid="ai-draft-quality-findings">
                {qualityFindingGroups.map((group) => (
                  <div className="space-y-2 rounded-xl border border-outline-variant/25 bg-surface-container-high/35 p-3" key={group.category}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-on-surface dark:text-on-surface">
                        {AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS[group.category]}
                      </p>
                      <span className="rounded-full bg-surface-container-highest px-2 py-1 text-xs tm-muted">
                        {group.findings.length} 项
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.findings.map((finding) => (
                        <label
                          className="flex items-start gap-3 rounded-lg bg-surface-container px-3 py-2 text-sm ring-1 ring-outline-variant/20"
                          data-testid="ai-draft-quality-finding"
                          key={finding.id}
                        >
                          <input
                            checked={selectedQualityFindingIds.has(finding.id)}
                            className="mt-1 size-4 shrink-0"
                            data-testid="ai-draft-quality-checkbox"
                            disabled={!finding.repairable || repairGenerating}
                            onChange={() => toggleQualityFinding(finding.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-on-surface dark:text-on-surface">{finding.title}</span>
                              <span className={qualitySeverityPillClass(finding.severity)}>
                                {qualitySeverityLabel(finding.severity)}
                              </span>
                              {finding.dayDate && <span className="text-xs tm-muted">{finding.dayDate}</span>}
                            </span>
                            <span className="mt-1 block break-words leading-6 tm-muted [overflow-wrap:anywhere]">
                              {finding.message}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {qualityResult && qualityResult.status !== 'clean' && (
                  <p className="text-xs text-on-surface-variant dark:text-outline">
                    这些提示不会阻止导入，请在确认前检查。
                  </p>
                )}
              </div>
            )}

            {repairableQualityFindings.length > 0 && (
              proxyConfig.configured ? (
                <Button
                  onClick={() => setShowRepairConfirm(true)}
                  variant="secondary"
                  className="w-full"
                  data-testid="ai-draft-repair-action"
                  disabled={selectedQualityRepairCount === 0}
                  loading={repairGenerating}
                >
                  修复选中问题
                  {selectedQualityRepairCount > 0 ? `（${selectedQualityRepairCount}）` : ''}
                </Button>
              ) : (
                <Button disabled className="w-full" data-testid="ai-draft-repair-action" variant="secondary">
                  当前未配置 AI 修复服务
                </Button>
              )
            )}
          </Card>

          {repairSuccessMessage && (
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
              <p className="text-sm text-green-700 dark:text-green-300">{repairSuccessMessage}</p>
            </Card>
          )}

          {repairError && (
            <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-sm text-red-700 dark:text-red-300">{repairError}</p>
            </Card>
          )}

          <Card className="space-y-3" data-testid="ai-draft-refine-panel">
            <div className="space-y-1">
              <h3 className="font-medium text-on-surface dark:text-on-surface">调整整体偏好后再生成</h3>
              <p className="text-sm tm-muted">
                选择草案内日期范围，确认后只替换所选日期；范围外已编辑内容会保留。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>开始日期</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  data-testid="ai-draft-refine-start-date"
                  value={rangeRefineStartDate || draftDateOptions[0] || ''}
                  onChange={(event) => setRangeRefineStartDate(event.target.value)}
                >
                  {draftDateOptions.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>结束日期</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  data-testid="ai-draft-refine-end-date"
                  value={rangeRefineEndDate || draftDateOptions[draftDateOptions.length - 1] || ''}
                  onChange={(event) => setRangeRefineEndDate(event.target.value)}
                >
                  {draftDateOptions.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="同行人数"
                value={rangeRefinePartySize}
                onChange={setRangeRefinePartySize}
                type="number"
              />
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>旅行节奏</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  value={rangeRefinePace}
                  onChange={(event) => setRangeRefinePace(event.target.value as typeof rangeRefinePace)}
                >
                  <option value="relaxed">轻松</option>
                  <option value="moderate">适中</option>
                  <option value="compact">紧凑</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>交通偏好</span>
              <select
                className={FIELD_SELECT_CLASS}
                value={rangeRefinePreferTransport}
                onChange={(event) => setRangeRefinePreferTransport(event.target.value as typeof rangeRefinePreferTransport)}
              >
                <option value="public_transport">公共交通</option>
                <option value="walking">步行</option>
                <option value="taxi">打车</option>
                <option value="mixed">综合</option>
              </select>
            </label>
            <div className="space-y-2">
              <span className={FIELD_LABEL_CLASS}>兴趣标签</span>
              <div className="flex flex-wrap gap-2" data-testid="ai-draft-refine-interest-tags">
                {INTEREST_TAGS.map((tag) => {
                  const selected = rangeRefineInterestTags.includes(tag)
                  return (
                    <button
                      className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
                        selected
                          ? 'border-primary/40 bg-primary-container text-on-primary-container'
                          : 'border-outline-variant/30 bg-surface-container text-on-surface-variant'
                      }`}
                      key={tag}
                      onClick={() => setRangeRefineInterestTags((current) =>
                        current.includes(tag)
                          ? current.filter((item) => item !== tag)
                          : [...current, tag],
                      )}
                      type="button"
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>兴趣偏好</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                data-testid="ai-draft-refine-interest-text"
                value={rangeRefineInterestText}
                onChange={(event) => setRangeRefineInterestText(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>想去的地方</span>
                <textarea
                  className={`${FIELD_TEXTAREA_CLASS} h-20`}
                  value={rangeRefineMustVisit}
                  onChange={(event) => setRangeRefineMustVisit(event.target.value)}
                />
              </label>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>不想要的安排</span>
                <textarea
                  className={`${FIELD_TEXTAREA_CLASS} h-20`}
                  value={rangeRefineAvoid}
                  onChange={(event) => setRangeRefineAvoid(event.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>补充要求</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                value={rangeRefineFreeText}
                onChange={(event) => setRangeRefineFreeText(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>本次优化说明</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                data-testid="ai-draft-refine-guidance"
                value={rangeRefineGuidance}
                onChange={(event) => setRangeRefineGuidance(event.target.value)}
              />
            </label>
            <Button
              className="w-full"
              data-testid="ai-draft-range-refine-action"
              disabled={!proxyConfig.configured || refineGenerating}
              loading={refineGenerating && showRangeRefineConfirm}
              onClick={openRangeRefineConfirm}
              variant="secondary"
            >
              调整整体偏好后再生成
            </Button>
          </Card>

          {refineSuccessMessage && (
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30" data-testid="ai-draft-refine-success">
              <p className="whitespace-pre-line text-sm text-green-700 dark:text-green-300">{refineSuccessMessage}</p>
            </Card>
          )}

          {refineError && (
            <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30" data-testid="ai-draft-refine-error">
              <p className="whitespace-pre-line text-sm text-red-700 dark:text-red-300">{refineError}</p>
            </Card>
          )}

          <Card className="space-y-4" data-testid="ai-draft-preview">
            <h3 className="font-medium text-on-surface dark:text-on-surface">行程草案编辑</h3>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="旅行标题" value={draft!.title} onChange={(value) => updateDraftRoot({ title: value })} />
              <FormField label="目的地" value={draft!.destination} onChange={(value) => updateDraftRoot({ destination: value })} />
              <FormField label="开始日期" type="date" value={draft!.startDate} onChange={(value) => updateDraftRoot({ startDate: value })} />
              <FormField label="结束日期" type="date" value={draft!.endDate} onChange={(value) => updateDraftRoot({ endDate: value })} />
            </div>
            <div className="space-y-4">
              {draft!.days.map((day, dayIndex) => (
                <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-high/35 p-3" data-testid="ai-draft-day-editor" key={`${day.date}-${dayIndex}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-on-surface dark:text-on-surface">
                      第 {dayIndex + 1} 天
                      <span className="ml-2 text-xs font-normal tm-muted">{day.date}</span>
                    </p>
                    <Button
                      className="min-h-11 px-3 text-xs"
                      data-testid="ai-draft-day-regenerate-button"
                      disabled={!proxyConfig.configured || refineGenerating}
                      loading={refineGenerating && pendingDayRefine?.date === day.date}
                      onClick={() => openDayRefine(day)}
                      variant="secondary"
                    >
                      重新生成本日
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      label={`第 ${dayIndex + 1} 天日期`}
                      onChange={(value) => updateDraftDay(dayIndex, { date: value })}
                      type="date"
                      value={day.date}
                    />
                    <FormField
                      label="每日主题"
                      onChange={(value) => updateDraftDay(dayIndex, { title: value })}
                      value={day.title ?? ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-on-surface dark:text-on-surface">每日提示</p>
                      <Button className="min-h-11 px-2 text-xs" onClick={() => addDraftDayTip(dayIndex)} variant="secondary">
                        添加提示
                      </Button>
                    </div>
                    {(day.tips ?? []).map((tip, tipIndex) => (
                      <div className="flex gap-2" key={tipIndex}>
                        <input
                          className={FIELD_INPUT_CLASS}
                          onChange={(event) => updateDraftDayTip(dayIndex, tipIndex, event.target.value)}
                          placeholder="例如：提前确认预约时间"
                          value={tip}
                        />
                        <Button className="min-h-11 shrink-0 px-3 text-xs" onClick={() => removeDraftDayTip(dayIndex, tipIndex)} variant="ghost">
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-on-surface dark:text-on-surface">行程点</p>
                      <Button className="min-h-11 px-2 text-xs" onClick={() => addDraftItem(dayIndex)} variant="secondary">
                        添加行程点
                      </Button>
                    </div>
                    {day.items.map((item, itemIndex) => (
                      <div className="space-y-3 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/25" data-testid="ai-draft-item-editor" key={itemIndex}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-on-surface-variant">#{itemIndex + 1}</p>
                          <div className="flex gap-1">
                            <Button className="min-h-11 px-2 text-xs" disabled={itemIndex === 0} onClick={() => moveDraftItem(dayIndex, itemIndex, -1)} variant="ghost">
                              上移
                            </Button>
                            <Button className="min-h-11 px-2 text-xs" disabled={itemIndex === day.items.length - 1} onClick={() => moveDraftItem(dayIndex, itemIndex, 1)} variant="ghost">
                              下移
                            </Button>
                            <Button className="min-h-11 px-2 text-xs" onClick={() => removeDraftItem(dayIndex, itemIndex)} variant="ghost">
                              删除
                            </Button>
                          </div>
                        </div>
                        <FormField label="标题" value={item.title} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { title: value })} />
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="开始" type="time" value={item.startTime ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { startTime: value || undefined })} />
                          <FormField label="结束" type="time" value={item.endTime ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { endTime: value || undefined })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="地点" value={item.locationName ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { locationName: value || undefined })} />
                          <FormField label="地址" value={item.address ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { address: value || undefined })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="纬度" type="number" value={item.lat?.toString() ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { lat: parseOptionalNumber(value) })} />
                          <FormField label="经度" type="number" value={item.lng?.toString() ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { lng: parseOptionalNumber(value) })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className={FIELD_LABEL_CLASS}>到达交通</span>
                            <select
                              className={FIELD_SELECT_CLASS}
                              onChange={(event) => updateDraftItem(dayIndex, itemIndex, { previousTransportMode: normalizeTransportModeInput(event.target.value) })}
                              value={item.previousTransportMode ?? ''}
                            >
                              <option value="">未指定</option>
                              <option value="walk">步行</option>
                              <option value="transit">公共交通</option>
                              <option value="bus">公交</option>
                              <option value="car">驾车/打车</option>
                              <option value="train">火车</option>
                              <option value="flight">航班</option>
                              <option value="other">其他</option>
                            </select>
                          </label>
                          <FormField
                            label="交通分钟"
                            type="number"
                            value={item.previousTransportDurationMinutes?.toString() ?? ''}
                            onChange={(value) => updateDraftItem(dayIndex, itemIndex, { previousTransportDurationMinutes: parseOptionalInteger(value) })}
                          />
                        </div>
                        <label className="block">
                          <span className={FIELD_LABEL_CLASS}>交通备注</span>
                          <textarea
                            className={`${FIELD_TEXTAREA_CLASS} h-16`}
                            onChange={(event) => updateDraftItem(dayIndex, itemIndex, { previousTransportNote: event.target.value || undefined })}
                            value={item.previousTransportNote ?? ''}
                          />
                        </label>
                        <label className="block">
                          <span className={FIELD_LABEL_CLASS}>行程备注</span>
                          <textarea
                            className={`${FIELD_TEXTAREA_CLASS} h-16`}
                            onChange={(event) => updateDraftItem(dayIndex, itemIndex, { note: event.target.value || undefined })}
                            value={item.note ?? ''}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30" data-testid="ai-draft-privacy-note">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              这里的修改只更新当前草案。
              <br />
              确认导入后才会写入本地旅行。
            </p>
          </Card>

          <Button disabled={!canImportDraft} onClick={() => setShowConfirm(true)} className="w-full">
            确认导入
          </Button>
        </>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="最终导入检查"
        body={`请确认即将创建的本地旅行。\n确认前不会写入本地旅行，也不会调用路线、地点、搜索、AI、票据或云端服务。`}
        confirmLabel="确认导入"
        cancelLabel="取消"
        loading={importing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmImport}
        testId="ai-draft-import-confirm-dialog"
      >
        {draftImportCheck ? <AiDraftImportCheckPanel check={draftImportCheck} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={showProxyConfirm}
        title="通过旅图服务生成完整行程"
        body={`将通过旅图服务生成完整行程草案\n可能消耗服务额度\n不会自动创建旅行\n生成后仍需预览和确认\n当前不会读取票据图片/PDF`}
        confirmLabel="确认生成"
        cancelLabel="取消"
        loading={proxyGenerating}
        onCancel={() => setShowProxyConfirm(false)}
        onConfirm={handleProxyConfirm}
        testId="ai-draft-generate-confirm-dialog"
      />

      <ConfirmDialog
        open={showVariantConfirm}
        title="生成三种方案"
        body={`将通过旅图服务分别生成经典游、轻松游、深度游三份草案\n会发起 3 次 AI 草案生成请求，可能消耗 3 次服务额度\n生成结果只进入多方案预览\n选择方案前不会创建旅行\n不会调用路线、地点、搜索、票据或云端服务`}
        confirmLabel="确认生成"
        cancelLabel="取消"
        loading={variantGenerating}
        onCancel={() => setShowVariantConfirm(false)}
        onConfirm={handleVariantConfirm}
        testId="ai-draft-variants-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingVariantRetry)}
        title="重新生成方案"
        body={`将通过旅图服务重新生成 ${pendingVariantRetry ? getVariantLabel(pendingVariantRetry) : ''} 草案\n会发起 1 次 AI 草案生成请求\n只替换这个方案卡片\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认重新生成"
        cancelLabel="取消"
        loading={variantGenerating && Boolean(pendingVariantRetry)}
        onCancel={() => setPendingVariantRetry(null)}
        onConfirm={handleVariantRetryConfirm}
        testId="ai-draft-variant-retry-confirm-dialog"
      />

      <ConfirmDialog
        open={showRepairConfirm}
        title="修复选中问题"
        body={`将通过旅图服务尝试修复 ${selectedQualityRepairCount} 个选中问题\n可能消耗服务额度\n未勾选的问题和无关内容会要求保持不变\n不会自动创建旅行\n不会直接覆盖已保存旅行\n修复后仍需预览和确认${repairPrivacyNotice ? `\n${repairPrivacyNotice}` : ''}`}
        confirmLabel="确认修复"
        cancelLabel="取消"
        loading={repairGenerating}
        onCancel={() => setShowRepairConfirm(false)}
        onConfirm={handleRepairConfirm}
        testId="ai-draft-repair-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingDayRefine)}
        title="重新生成本日"
        body={`将通过旅图服务重新生成 ${pendingDayRefine?.date ?? ''} 的草案内容\n可能消耗服务额度\n只替换这一天\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认重新生成"
        cancelLabel="取消"
        loading={refineGenerating && Boolean(pendingDayRefine)}
        onCancel={() => {
          setPendingDayRefine(null)
          setDayRefineGuidance('')
        }}
        onConfirm={handleDayRefineConfirm}
        testId="ai-draft-day-refine-confirm-dialog"
      >
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>本日调整要求</span>
          <textarea
            className={`${FIELD_TEXTAREA_CLASS} h-24`}
            data-testid="ai-draft-day-refine-guidance"
            placeholder={pendingDayRefine?.title ? `例如：让“${pendingDayRefine.title}”更轻松一些` : '例如：减少购物，增加咖啡馆和休息时间'}
            value={dayRefineGuidance}
            onChange={(event) => setDayRefineGuidance(event.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={showRangeRefineConfirm}
        title="调整整体偏好后再生成"
        body={`将通过旅图服务优化 ${rangeRefineStartDate} 至 ${rangeRefineEndDate}\n可能消耗服务额度\n只替换所选日期范围\n范围外草案和已编辑内容会保留\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认优化"
        cancelLabel="取消"
        loading={refineGenerating && showRangeRefineConfirm}
        onCancel={() => setShowRangeRefineConfirm(false)}
        onConfirm={handleRangeRefineConfirm}
        testId="ai-draft-range-refine-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingDraftPlaceCandidate)}
        title="填入候选地点"
        body={`将把候选地点写入当前草案\n只更新地点名称、地址和坐标\n不会创建本地旅行\n不会写入数据库、路线缓存、票据或云端`}
        confirmLabel="填入草案"
        cancelLabel="取消"
        onCancel={() => setPendingDraftPlaceCandidate(null)}
        onConfirm={confirmApplyDraftPlaceCandidate}
        testId="ai-draft-place-lookup-confirm-dialog"
      >
        {pendingDraftPlaceCandidate ? (
          <div className="space-y-2 rounded-xl bg-surface-container px-3 py-2 text-sm">
            <p className="break-words font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
              {pendingDraftPlaceCandidate.candidate.displayName}
            </p>
            <p className="break-words tm-muted [overflow-wrap:anywhere]">
              {pendingDraftPlaceCandidate.candidate.formattedAddress}
            </p>
            <p className="break-words text-xs tm-muted [overflow-wrap:anywhere]">
              {formatPlaceLookupCandidateCoordinate(pendingDraftPlaceCandidate.candidate)}
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

function AiDraftImportCheckPanel({ check }: { check: AiTripDraftImportCheck }) {
  return (
    <div className="space-y-3" data-testid="ai-draft-import-check">
      <div className="space-y-1 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/20">
        <p className="break-words text-sm font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
          {check.title}
        </p>
        <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
          {check.destination} · {check.dateRangeLabel}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <ImportCheckMetric label="天数" value={`${check.dayCount} 天`} />
        <ImportCheckMetric label="行程点" value={`${check.itemCount} 个`} />
        <ImportCheckMetric label="有效坐标" value={`${check.validCoordinateCount} 个`} />
        <ImportCheckMetric
          label="缺坐标"
          value={check.invalidCoordinateCount > 0
            ? `${check.missingCoordinateCount} 缺失 / ${check.invalidCoordinateCount} 异常`
            : `${check.missingCoordinateCount} 个`}
        />
        <ImportCheckMetric label="路线可生成" value={`${check.routeReadyDayCount} 天`} />
        <ImportCheckMetric label="每日提示" value={`${check.dailyTipCount} 条`} />
      </dl>

      <div className="space-y-2 rounded-xl bg-surface-container px-3 py-3 text-sm leading-6 ring-1 ring-outline-variant/20">
        <p className="break-words font-medium text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
          路线提示
        </p>
        <p className="break-words tm-muted [overflow-wrap:anywhere]" data-testid="ai-draft-import-check-route-summary">
          {check.routeSummary}
        </p>
      </div>

      <div className="space-y-2 rounded-xl bg-blue-50/70 px-3 py-3 text-sm leading-6 text-blue-800 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-800/60">
        <p className="break-words font-medium [overflow-wrap:anywhere]">云端自动同步</p>
        <p className="break-words [overflow-wrap:anywhere]" data-testid="ai-draft-import-check-sync-summary">
          {check.autoSyncMessage}
        </p>
        <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
          导入确认会先写入此设备；登录状态下，现有同步控制器会按设置继续处理。
        </p>
      </div>

      <p className="break-words rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
        每日提示会按天追加到旅行备注；导入后仍会显示路线生成提示，确认生成前不会调用路线服务。
      </p>
    </div>
  )
}

function ImportCheckMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-container px-3 py-2 ring-1 ring-outline-variant/20" data-testid="ai-draft-import-check-metric">
      <dt className="text-xs tm-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}

function AiDraftMapPreviewCard({
  activePreview,
  adjustment,
  applyError,
  missingCoordinateItems,
  orderMessage,
  onActiveDateChange,
  onApplyMapOrder,
  onSearchMissingCoordinate,
  onSelectPlaceCandidate,
  placeLookupConfigured,
  placeLookups,
  previews,
}: {
  activePreview: AiTripDraftMapPreviewDay | null
  adjustment: AiTripDraftMapOrderAdjustmentResult | null
  applyError: string | null
  missingCoordinateItems: AiTripDraftMissingCoordinateLookupItem[]
  orderMessage: string | null
  onActiveDateChange: (date: string) => void
  onApplyMapOrder: () => void
  onSearchMissingCoordinate: (lookupItem: AiTripDraftMissingCoordinateLookupItem) => void
  onSelectPlaceCandidate: (lookupItem: AiTripDraftMissingCoordinateLookupItem, candidate: ProviderProxyPlaceLookupResult) => void
  placeLookupConfigured: boolean
  placeLookups: Record<string, DraftPlaceLookupState>
  previews: AiTripDraftMapPreviewDay[]
}) {
  if (previews.length === 0 || !activePreview) return null

  const linePoints = activePreview.points.map((point) => `${point.x},${point.y}`).join(' ')
  const reorderDisabled = !adjustment?.changed

  return (
    <Card className="space-y-4" data-testid="ai-draft-map-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-on-surface dark:text-on-surface">地图预览</h3>
          <p className="break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">
            基于当前草案坐标本地绘制，用直线展示大致分布和顺序。
          </p>
        </div>
        <label className="min-w-[min(100%,12rem)] shrink-0">
          <span className={FIELD_LABEL_CLASS}>预览日期</span>
          <select
            className={FIELD_SELECT_CLASS}
            data-testid="ai-draft-map-preview-day-select"
            value={activePreview.date}
            onChange={(event) => onActiveDateChange(event.target.value)}
          >
            {previews.map((preview) => (
              <option key={`${preview.date}-${preview.dayIndex}`} value={preview.date}>
                第 {preview.dayIndex + 1} 天 · {preview.date}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <MapPreviewMetric label="坐标点" value={`${activePreview.coordinateCount}/${activePreview.itemCount}`} />
        <MapPreviewMetric label="直线距离" value={formatAiTripDraftMapDistance(activePreview.totalDistanceMeters)} />
        <MapPreviewMetric label="路径线段" value={`${activePreview.segments.length}`} />
      </dl>

      <div className="space-y-2 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface dark:text-on-surface">按地图顺序调整本日行程</p>
            <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
              使用本地直线距离排序，不代表真实道路最优路线。
            </p>
          </div>
          <Button
            className="min-h-10 shrink-0 px-3 text-xs"
            data-testid="ai-draft-map-order-action"
            disabled={reorderDisabled}
            onClick={onApplyMapOrder}
            variant="secondary"
          >
            按地图顺序调整本日行程
          </Button>
        </div>
        {orderMessage && (
          <p
            className="break-words rounded-lg bg-green-50 px-3 py-2 text-sm leading-6 text-green-800 dark:bg-green-500/10 dark:text-green-200 [overflow-wrap:anywhere]"
            data-testid="ai-draft-map-order-message"
          >
            {orderMessage}
          </p>
        )}
        {reorderDisabled && adjustment?.reason && !orderMessage && (
          <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]" data-testid="ai-draft-map-order-disabled-reason">
            {adjustment.reason}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/20" data-testid="ai-draft-place-lookup-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface dark:text-on-surface">缺坐标地点补全</p>
            <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
              对当前日期缺坐标地点查找候选，确认后只填入当前草案。
            </p>
          </div>
          <span className="rounded-full bg-surface-container-highest px-2 py-1 text-xs font-semibold tm-muted">
            {missingCoordinateItems.length} 个待补全
          </span>
        </div>
        {!placeLookupConfigured && missingCoordinateItems.length > 0 && (
          <p className="break-words rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 [overflow-wrap:anywhere]">
            当前未配置地点查询服务。
          </p>
        )}
        {applyError && (
          <p
            className="break-words rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 [overflow-wrap:anywhere]"
            data-testid="ai-draft-place-lookup-apply-error"
          >
            {applyError}
          </p>
        )}
        {missingCoordinateItems.length === 0 ? (
          <p className="break-words text-sm leading-6 text-green-700 dark:text-green-300 [overflow-wrap:anywhere]">
            当前日期的行程点都有有效坐标。
          </p>
        ) : (
          <div className="space-y-3">
            {missingCoordinateItems.map((lookupItem) => {
              const state = placeLookups[lookupItem.lookupKey]
              return (
                <div
                  className="space-y-3 rounded-lg bg-surface-container-high/60 px-3 py-3 ring-1 ring-outline-variant/20"
                  data-testid="ai-draft-place-lookup-item"
                  key={lookupItem.lookupKey}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
                        #{lookupItem.number} {lookupItem.title}
                      </p>
                      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                        {lookupItem.timeLabel} · {lookupItem.locationLabel}
                      </p>
                      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                        查询：{lookupItem.query || '无可用查询词'}
                      </p>
                    </div>
                    <Button
                      className="min-h-11 shrink-0 px-3 text-xs"
                      data-testid="ai-draft-place-lookup-search"
                      disabled={!lookupItem.query || state?.loading}
                      icon={<Search className="size-4" />}
                      loading={Boolean(state?.loading)}
                      onClick={() => onSearchMissingCoordinate(lookupItem)}
                      variant="secondary"
                    >
                      查找候选
                    </Button>
                  </div>
                  {state?.error ? (
                    <p
                      className="break-words rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 [overflow-wrap:anywhere]"
                      data-testid="ai-draft-place-lookup-error"
                    >
                      {state.error}
                    </p>
                  ) : null}
                  {state?.results.length ? (
                    <div className="space-y-2" data-testid="ai-draft-place-lookup-results">
                      {state.results.map((candidate) => (
                        <div
                          className="grid min-w-0 grid-cols-[auto,minmax(0,1fr)] gap-3 rounded-xl bg-white px-3 py-3 ring-1 ring-outline-variant/30 dark:bg-surface-dim/70 dark:ring-outline-variant/30"
                          data-testid="ai-draft-place-lookup-result"
                          key={candidate.placeId}
                        >
                          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container/20 text-primary">
                            <MapPinned className="size-5" />
                          </span>
                          <div className="min-w-0 space-y-2">
                            <div className="min-w-0">
                              <p className="break-words font-body-lg text-body-lg text-on-surface [overflow-wrap:anywhere]">
                                {candidate.displayName}
                              </p>
                              <p className="mt-0.5 break-words font-body-md text-body-md text-on-surface-variant [overflow-wrap:anywhere]">
                                {candidate.formattedAddress}
                              </p>
                              <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                                {formatPlaceLookupCandidateCoordinate(candidate)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full bg-surface-container-highest px-2 py-1 font-semibold tm-muted">
                                来源：{formatPlaceLookupCandidateProvider(candidate)}
                              </span>
                              <span className="rounded-full bg-surface-container-highest px-2 py-1 font-semibold tm-muted">
                                {formatPlaceLookupCandidateRetrievedAt(candidate)}
                              </span>
                              {candidate.googleMapsUri ? (
                                <a
                                  className="inline-flex min-h-7 items-center gap-1 rounded-full bg-primary-container/20 px-2 py-1 font-semibold text-primary"
                                  href={candidate.googleMapsUri}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <ExternalLink className="size-3" />
                                  Google Maps
                                </a>
                              ) : null}
                            </div>
                            <Button
                              className="min-h-11 w-full text-xs"
                              data-testid="ai-draft-place-lookup-use-result"
                              onClick={() => onSelectPlaceCandidate(lookupItem, candidate)}
                              variant="secondary"
                            >
                              使用此候选
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div
        className="relative aspect-[4/3] min-h-[220px] overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-high"
        data-testid="ai-draft-map-preview-canvas"
      >
        {activePreview.points.length > 0 ? (
          <svg
            aria-label={`${activePreview.date} 草案地图预览`}
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            viewBox="0 0 100 100"
          >
            <defs>
              <pattern height="20" id={`draft-map-grid-${activePreview.dayIndex}`} patternUnits="userSpaceOnUse" width="20">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect className="text-on-surface-variant" fill={`url(#draft-map-grid-${activePreview.dayIndex})`} height="100" width="100" />
            {linePoints && activePreview.points.length > 1 && (
              <polyline
                data-testid="ai-draft-map-preview-path"
                fill="none"
                points={linePoints}
                stroke="rgb(var(--color-primary, 103 80 164))"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.34"
                strokeWidth="3"
              />
            )}
            {activePreview.segments.map((segment) => (
              <line
                data-testid="ai-draft-map-preview-segment"
                key={`${segment.fromItemIndex}-${segment.toItemIndex}`}
                stroke={segment.warning ? 'rgb(180 83 9)' : 'rgb(var(--color-primary, 103 80 164))'}
                strokeDasharray={segment.warning ? '4 3' : undefined}
                strokeLinecap="round"
                strokeOpacity={segment.warning ? '0.85' : '0.72'}
                strokeWidth={segment.warning ? '2.4' : '1.8'}
                x1={segment.x1}
                x2={segment.x2}
                y1={segment.y1}
                y2={segment.y2}
              />
            ))}
            {activePreview.points.map((point, index) => {
              const endpointClass = index === 0
                ? 'fill-green-600'
                : index === activePreview.points.length - 1
                  ? 'fill-blue-600'
                  : 'fill-primary'
              return (
                <g
                  data-testid="ai-draft-map-preview-marker"
                  key={`${point.itemIndex}-${point.title}`}
                  transform={`translate(${point.x} ${point.y})`}
                >
                  <circle
                    className={endpointClass}
                    r="4.6"
                    stroke="white"
                    strokeWidth="1.4"
                  />
                  <text
                    dy="0.35em"
                    fill="white"
                    fontSize="4.2"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {point.number}
                  </text>
                  <title>{point.title} · {point.locationLabel}</title>
                </g>
              )
            })}
          </svg>
        ) : (
          <div className="flex h-full min-h-[220px] items-center justify-center p-6 text-center">
            <p className="max-w-xs text-sm leading-6 tm-muted">
              当前日期暂无可用于地图预览的坐标。
            </p>
          </div>
        )}
      </div>

      {activePreview.warnings.length > 0 && (
        <div className="space-y-2" data-testid="ai-draft-map-preview-warnings">
          {activePreview.warnings.map((warning, index) => (
            <p
              className="break-words rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 [overflow-wrap:anywhere]"
              data-testid="ai-draft-map-preview-warning"
              key={`${warning.type}-${index}`}
            >
              {warning.message}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2" data-testid="ai-draft-map-preview-order-list">
        <p className="text-xs font-semibold text-on-surface dark:text-on-surface">当前路线顺序</p>
        {activePreview.items.map((item) => (
          <div
            className="grid grid-cols-[auto,minmax(0,1fr)] gap-3 rounded-lg bg-surface-container px-3 py-2 ring-1 ring-outline-variant/20"
            data-testid="ai-draft-map-preview-order-item"
            key={`${item.itemIndex}-${item.title}`}
          >
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              item.hasValidCoordinate
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-highest text-on-surface-variant'
            }`}>
              {item.number}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words text-sm font-medium text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
                  {item.title}
                </p>
                {!item.participatesInPath && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                    未参与地图线段
                  </span>
                )}
              </div>
              <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                {item.timeLabel} · {item.locationLabel}
              </p>
              <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                {item.coordinateLabel}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function MapPreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-container px-3 py-2 ring-1 ring-outline-variant/20">
      <dt className="text-xs tm-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}

function formatPlaceLookupCandidateCoordinate(candidate: ProviderProxyPlaceLookupResult): string {
  if (!candidate.location) return '候选缺少坐标'
  return `${candidate.location.lat.toFixed(5)}, ${candidate.location.lng.toFixed(5)}`
}

function formatPlaceLookupCandidateProvider(candidate: ProviderProxyPlaceLookupResult): string {
  if (candidate.provider === 'google_places') return 'Google Places'
  return candidate.provider
}

function formatPlaceLookupCandidateRetrievedAt(candidate: ProviderProxyPlaceLookupResult): string {
  return `来源时间：${candidate.retrievedAt.slice(0, 10)}`
}

function AiDraftVariantComparisonPanel({
  comparisons,
  disabled,
  mixDays,
  mixError,
  mixSelection,
  onBuildMix,
  onMixSelectionChange,
}: {
  comparisons: ReturnType<typeof buildAiTripDraftVariantComparisons>
  disabled: boolean
  mixDays: ReturnType<typeof buildAiTripDraftVariantMixDays>
  mixError: string | null
  mixSelection: ReturnType<typeof buildDefaultAiTripDraftVariantMixSelection>
  onBuildMix: () => void
  onMixSelectionChange: (date: string, kind: AiTripDraftVariantKind) => void
}) {
  if (comparisons.length === 0) return null

  return (
    <div className="space-y-3" data-testid="ai-draft-variant-comparison">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-on-surface dark:text-on-surface">方案对比</h4>
          <p className="text-xs tm-muted">基于已生成草案本地计算，不会发起额外请求。</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {comparisons.map((comparison) => (
          <div
            className="min-w-0 space-y-3 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/25"
            data-testid="ai-draft-variant-comparison-card"
            key={comparison.definition.kind}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-on-surface dark:text-on-surface">{comparison.definition.label}</p>
              <span className={variantStatusPillClass(comparison.status)}>
                {comparison.statusText}
              </span>
            </div>
            {comparison.metrics ? (
              <dl className="space-y-2 text-sm">
                <ComparisonRow label="节奏" value={comparison.metrics.paceLabel} />
                <ComparisonRow
                  label="每日强度"
                  value={comparison.metrics.dailyIntensity.label}
                  detail={comparison.metrics.dailyIntensity.detail}
                />
                <ComparisonRow
                  label="交通复杂度"
                  value={comparison.metrics.transportComplexity.label}
                  detail={comparison.metrics.transportComplexity.detail}
                />
                <ComparisonRow label="景点数量" value={comparison.metrics.spotCount.detail} />
                <ComparisonRow label="适合人群" value={comparison.bestFor} />
              </dl>
            ) : (
              <p className="break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">
                {comparison.statusText}
              </p>
            )}
          </div>
        ))}
      </div>
      <div
        className="space-y-3 rounded-xl bg-surface-container-high/45 p-3 ring-1 ring-outline-variant/25"
        data-testid="ai-draft-variant-mix-panel"
      >
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-on-surface dark:text-on-surface">混合生成</h4>
          <p className="text-xs tm-muted">
            按日期选择喜欢的来源方案，生成一个新的可编辑混合草案。
          </p>
        </div>
        {mixDays.length > 0 ? (
          <div className="space-y-3">
            <div className="grid gap-3">
              {mixDays.map((day) => (
                <label className="block" data-testid="ai-draft-variant-mix-day" key={day.date}>
                  <span className={FIELD_LABEL_CLASS}>
                    第 {day.dayIndex + 1} 天 · {day.date}
                  </span>
                  <select
                    className={FIELD_SELECT_CLASS}
                    data-testid="ai-draft-variant-mix-select"
                    disabled={disabled || day.options.length === 0}
                    value={mixSelection[day.date] ?? day.options[0]?.kind ?? ''}
                    onChange={(event) => onMixSelectionChange(day.date, event.target.value as AiTripDraftVariantKind)}
                  >
                    {day.options.map((option) => (
                      <option key={option.kind} value={option.kind}>
                        {option.label}{option.dayTitle ? ` · ${option.dayTitle}` : ''} · {option.itemCount} 个点
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {mixError && (
              <p className="whitespace-pre-line break-words text-sm text-red-700 dark:text-red-300 [overflow-wrap:anywhere]">
                {mixError}
              </p>
            )}
            <Button
              className="w-full"
              data-testid="ai-draft-variant-mix-action"
              disabled={disabled || mixDays.length === 0}
              onClick={onBuildMix}
              variant="secondary"
            >
              生成混合草案
            </Button>
          </div>
        ) : (
          <p className="text-sm tm-muted">至少需要一个已生成方案才能混合。</p>
        )}
      </div>
    </div>
  )
}

function ComparisonRow({
  detail,
  label,
  value,
}: {
  detail?: string
  label: string
  value: string
}) {
  return (
    <div>
      <dt className="text-xs tm-muted">{label}</dt>
      <dd className="break-words font-medium leading-6 text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
        {value}
      </dd>
      {detail && (
        <dd className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
          {detail}
        </dd>
      )}
    </div>
  )
}

function AiDraftVariantCard({
  disabled,
  onRetry,
  onSelect,
  state,
}: {
  disabled: boolean
  onRetry: () => void
  onSelect: () => void
  state: AiTripDraftVariantState
}) {
  const summary = state.draft ? summarizeAiTripDraftVariantDraft(state.draft) : null
  const selectable = Boolean(getSelectableAiTripDraftVariantDraft(state))

  return (
    <div
      className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-high/35 p-3"
      data-testid="ai-draft-variant-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-on-surface dark:text-on-surface">{state.definition.label}</p>
            <span className={variantStatusPillClass(state.status)}>
              {variantStatusLabel(state.status)}
            </span>
          </div>
          <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">
            {state.definition.description}
          </p>
        </div>
      </div>

      {state.status === 'loading' && (
        <p className="text-sm tm-muted">正在生成方案草案...</p>
      )}

      {state.error && (
        <div className="space-y-2">
          <p className="whitespace-pre-line break-words text-sm text-red-700 dark:text-red-300 [overflow-wrap:anywhere]">
            {state.error}
          </p>
          <Button
            className="min-h-11 px-3 text-xs"
            data-testid="ai-draft-variant-retry"
            disabled={disabled}
            onClick={onRetry}
            variant="secondary"
          >
            重新生成
          </Button>
        </div>
      )}

      {state.draft && summary && (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="tm-muted">标题</dt>
            <dd className="font-medium">{state.draft.title}</dd>
            <dt className="tm-muted">日期</dt>
            <dd>{state.draft.startDate} 至 {state.draft.endDate}</dd>
            <dt className="tm-muted">天数</dt>
            <dd>{summary.dayCount} 天</dd>
            <dt className="tm-muted">行程点</dt>
            <dd>{summary.itemCount} 个</dd>
          </dl>
          {state.warnings.length > 0 && (
            <p className="whitespace-pre-line break-words text-xs text-amber-700 dark:text-amber-300 [overflow-wrap:anywhere]">
              {state.warnings.join('\n')}
            </p>
          )}
          <Button
            className="w-full"
            data-testid="ai-draft-variant-select"
            disabled={disabled || !selectable}
            onClick={onSelect}
          >
            选择此方案
          </Button>
        </div>
      )}
    </div>
  )
}

function getVariantLabel(kind: AiTripDraftVariantKind): string {
  return AI_TRIP_DRAFT_VARIANTS.find((variant) => variant.kind === kind)?.label ?? '该方案'
}

function variantStatusLabel(status: AiTripDraftVariantState['status']) {
  if (status === 'loading') return '生成中'
  if (status === 'success') return '已生成'
  if (status === 'error') return '失败'
  return '待生成'
}

function variantStatusPillClass(status: AiTripDraftVariantState['status']) {
  const base = 'rounded-full px-2 py-1 text-xs font-medium'
  if (status === 'success') return `${base} bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200`
  if (status === 'error') return `${base} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200`
  if (status === 'loading') return `${base} bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200`
  return `${base} bg-surface-container-highest text-on-surface-variant`
}

function groupQualityFindingsByCategory(findings: AiTripDraftQualityFinding[]) {
  return QUALITY_CATEGORY_ORDER
    .map((category) => ({
      category,
      findings: findings.filter((finding) => finding.category === category),
    }))
    .filter((group) => group.findings.length > 0)
}

function qualitySeverityLabel(severity: AiTripDraftQualityFinding['severity']) {
  if (severity === 'critical') return '严重'
  if (severity === 'warning') return '提醒'
  return '信息'
}

function qualitySeverityPillClass(severity: AiTripDraftQualityFinding['severity']) {
  if (severity === 'critical') {
    return 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-200'
  }
  if (severity === 'warning') {
    return 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
  }
  return 'rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalInteger(value: string) {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return undefined
  return Number.isInteger(parsed) ? parsed : undefined
}

function normalizeTransportModeInput(value: string): TransportMode | undefined {
  const validModes: TransportMode[] = ['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other']
  return validModes.includes(value as TransportMode) ? value as TransportMode : undefined
}
