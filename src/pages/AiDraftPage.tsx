import { useEffect, useMemo, useRef, useState } from 'react'
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
  buildAiTripDraftVariantRequest,
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
  fetchProviderProxyAiTripDraft,
  fetchProviderProxyAiTripDraftRefine,
  fetchProviderProxyAiTripDraftRepair,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../lib/providerProxyClient'
import type {
  ProviderProxyAiTripDraftRequest,
  ProviderProxyAiTripDraftRefinePreferences,
  ProviderProxyAiTripDraftRefineScope,
} from '../lib/ai/providerProxyContract'
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
  const draftRef = useRef<AiTripDraft | null>(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const requestEndDate = useMemo(
    () => calculateEndDateFromDayCount(requestStartDate, Number(requestDayCount)),
    [requestDayCount, requestStartDate],
  )
  const draftDateOptions = useMemo(() => draft?.days.map((day) => day.date) ?? [], [draft])

  function previewDraftObject(draftObj: unknown) {
    const text = JSON.stringify(draftObj, null, 2)
    setJsonText(text)
    setVariantStates([])
    setPendingVariantRetry(null)
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
    setJsonText(JSON.stringify(SAMPLE_DRAFT, null, 2))
    setDraft(null)
    setErrors([])
  }

  function handleParse() {
    try {
      const input = JSON.parse(jsonText)
      const result = validateAiTripDraft(input)
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

  async function handleGenerateViaProxy() {
    if (!proxyConfig.proxyUrl) return

    const request = validateCurrentDraftRequestForGeneration()
    if (!request) return

    setRequestErrors([])
    setProxyError(null)
    setVariantStates([])
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
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
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

          <Card className="space-y-3" data-testid="ai-draft-quality-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-on-surface dark:text-on-surface">方案质量检查</h3>
                <p className="text-sm tm-muted">{qualityResult?.summary.message ?? '未发现明显问题。'}</p>
              </div>
              {repairableQualityFindings.length > 0 && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    className="min-h-9 px-3 text-xs"
                    data-testid="ai-draft-quality-select-all"
                    onClick={selectAllRepairableQualityFindings}
                    variant="ghost"
                  >
                    全选
                  </Button>
                  <Button
                    className="min-h-9 px-3 text-xs"
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
                      className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
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
                      className="min-h-9 px-3 text-xs"
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
                      <Button className="min-h-8 px-2 text-xs" onClick={() => addDraftDayTip(dayIndex)} variant="secondary">
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
                      <Button className="min-h-8 px-2 text-xs" onClick={() => addDraftItem(dayIndex)} variant="secondary">
                        添加行程点
                      </Button>
                    </div>
                    {day.items.map((item, itemIndex) => (
                      <div className="space-y-3 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/25" data-testid="ai-draft-item-editor" key={itemIndex}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-on-surface-variant">#{itemIndex + 1}</p>
                          <div className="flex gap-1">
                            <Button className="min-h-8 px-2 text-xs" disabled={itemIndex === 0} onClick={() => moveDraftItem(dayIndex, itemIndex, -1)} variant="ghost">
                              上移
                            </Button>
                            <Button className="min-h-8 px-2 text-xs" disabled={itemIndex === day.items.length - 1} onClick={() => moveDraftItem(dayIndex, itemIndex, 1)} variant="ghost">
                              下移
                            </Button>
                            <Button className="min-h-8 px-2 text-xs" onClick={() => removeDraftItem(dayIndex, itemIndex)} variant="ghost">
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
        title="导入行程草稿"
        body={`将创建新的本地旅行\n导入后会检查可生成路线的日程\n确认生成前不会调用路线服务\n不会创建票据\n不会上传云端\n可在创建后继续编辑`}
        confirmLabel="确认导入"
        cancelLabel="取消"
        loading={importing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmImport}
        testId="ai-draft-import-confirm-dialog"
      />

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
            className="min-h-9 px-3 text-xs"
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
