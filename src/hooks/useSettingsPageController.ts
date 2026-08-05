import { useCallback, useEffect, useState } from 'react'
import {
  getStoredAiPrivacySettings,
  saveAiPrivacySettings,
  type AiPrivacySettings,
} from '../lib/ai/aiPrivacy'
import {
  getAccountAiPreferences,
  getStoredAccountAiPreferences,
  saveAccountAiPreferences,
} from '../lib/accountAiPreferences'
import {
  isTravelInboxAutoRecognizeEnabled,
  setTravelInboxAutoRecognizeEnabled,
} from '../lib/ai/travelInbox'
import { importTripBackup } from '../lib/backup'
import { getRouteParams, navigateTo } from '../lib/routes'
import {
  importTripPlanPackage,
  parseTripPlanFile,
  type ImportTripPlanResult,
  type ParsedTripPlanFile,
} from '../lib/tripPlanImport'
import {
  ROUTE_CACHE_CHANGED_EVENT,
  clearRouteCache,
  getRouteCacheStats,
  setRouteCacheMaxBytes,
  type RouteCacheStats,
} from '../lib/routeCache'
import {
  ROUTING_CONFIG_CHANGED_EVENT,
  getRoutingConfig,
  type RoutingConfig,
} from '../lib/routing'
import {
  getStoredTravelProfile,
  normalizeTravelProfile,
  saveTravelProfile,
  type TravelProfile,
} from '../lib/travelProfile'
import { useAppearance } from '../lib/appearanceContext'
import { usePwaLifecycleState } from './usePwaLifecycleState'
import { applyPendingPwaUpdate } from '../lib/pwaLifecycle'
import { getTrip, listTrips } from '../db/repositories'
import {
  clearSyncedTicketBlobCachesForTrip,
  getTicketBlobCacheSummary,
} from '../lib/cloudObjectSync'
import type { Trip } from '../types'

type StorageEstimateState = {
  usage?: number
  quota?: number
}

type TicketCacheSummaryState = {
  cachedCount: number
  cachedSizeBytes: number
  clearableCount: number
  clearableSizeBytes: number
  totalCopyTickets: number
}

type PersistentStorageManager = StorageManager & {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export type SettingsSection = 'account' | 'preferences' | 'app' | 'advanced'

export const AI_PROMPT_SNIPPET = `请只输出可被 JSON.parse 解析的 JSON，不要输出 Markdown 或解释。
为旅图 TripMap 生成 schemaVersion 1 的 trip-plan.json：
- 顶层必须包含 schemaVersion: 1、type: "trip-plan"、trip、days，可选 tickets。
- 日期使用 YYYY-MM-DD，时间使用 HH:mm。
- 每个行程点尽量提供 title、locationName、address、lat、lng、notes。
- 交通方式只能使用 walk、transit、bus、car、train、flight、other。
- previousTransportDurationMinutes 只是估算，必须提醒用户人工核对。
- 不要编造已购票据。
- 如果没有真实附件，不要生成 storageMode: "copy"。
- JSON 单文件只使用 reference 或 external 票据。
- 只有我明确会把文件放进 zip 的 files/ 目录时，才生成 copy 票据，并填写相对 filePath，例如 files/hotel-confirmation.pdf。
- 不要生成本机绝对路径，不要包含 ../。
我的旅行需求如下：
[在这里填写目的地、日期、兴趣、已订酒店或门票信息]`

export function useSettingsPageController(section?: SettingsSection) {
  const contextTripId = getRouteParams().get('tripId')
  const { mode: appearanceMode, resolvedMode, setMode: setAppearanceMode } = useAppearance()
  const pwaLifecycle = usePwaLifecycleState()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedTripPlanFile, setSelectedTripPlanFile] = useState<File | null>(null)
  const [parsedTripPlan, setParsedTripPlan] = useState<ParsedTripPlanFile | null>(null)
  const [tripPlanSuccess, setTripPlanSuccess] = useState<ImportTripPlanResult | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateState | null>(null)
  const [isPersistenceSupported, setIsPersistenceSupported] = useState(false)
  const [persistedStorage, setPersistedStorage] = useState<boolean | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null)
  const [isRequestingPersistence, setIsRequestingPersistence] = useState(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [tripPlanFileInputKey, setTripPlanFileInputKey] = useState(0)
  const [isImporting, setIsImporting] = useState(false)
  const [isParsingTripPlan, setIsParsingTripPlan] = useState(false)
  const [isImportingTripPlan, setIsImportingTripPlan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [tripPlanError, setTripPlanError] = useState<string | null>(null)
  const [copyPromptMessage, setCopyPromptMessage] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(() => getRoutingConfig())
  const [routeCacheStats, setRouteCacheStats] = useState<RouteCacheStats | null>(null)
  const [routeCacheError, setRouteCacheError] = useState<string | null>(null)
  const [isClearingRouteCache, setIsClearingRouteCache] = useState(false)
  const [ticketCacheSummary, setTicketCacheSummary] = useState<TicketCacheSummaryState | null>(null)
  const [ticketCacheMessage, setTicketCacheMessage] = useState<string | null>(null)
  const [ticketCacheError, setTicketCacheError] = useState<string | null>(null)
  const [isClearingTicketCache, setIsClearingTicketCache] = useState(false)
  const [isUpdatingRouteCacheLimit, setIsUpdatingRouteCacheLimit] = useState(false)
  const [travelProfile, setTravelProfile] = useState<TravelProfile>(() => getStoredTravelProfile())
  const [aiPrivacySettings, setAiPrivacySettings] = useState<AiPrivacySettings>(() => getStoredAiPrivacySettings())
  const [travelInboxAutoRecognize, setTravelInboxAutoRecognize] = useState(() => isTravelInboxAutoRecognizeEnabled())
  const [autoExpenseAiEnabled, setAutoExpenseAiEnabled] = useState(() => getStoredAccountAiPreferences().autoExpenseAiEnabled)
  const [autoExpenseAiBusy, setAutoExpenseAiBusy] = useState(false)
  const [autoExpenseAiMessage, setAutoExpenseAiMessage] = useState('')
  const [isApplyingPwaUpdate, setIsApplyingPwaUpdate] = useState(false)
  const [pwaUpdateMessage, setPwaUpdateMessage] = useState('')
  const [contextTrip, setContextTrip] = useState<Trip | null>(null)

  useEffect(() => {
    let cancelled = false
    const contextTripRequest =
      section === 'account' && contextTripId ? getTrip(contextTripId) : Promise.resolve(null)

    void contextTripRequest.then((trip) => {
      if (!cancelled) setContextTrip(trip ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [contextTripId, section])

  const refreshStorageStatus = useCallback(async () => {
    const storage = navigator.storage as PersistentStorageManager | undefined
    if (!storage) {
      setStorageEstimate(null)
      setIsPersistenceSupported(false)
      setPersistedStorage(null)
      return
    }

    if (storage.estimate) {
      try {
        const estimate = await storage.estimate()
        setStorageEstimate({ quota: estimate.quota, usage: estimate.usage })
      } catch {
        setStorageEstimate(null)
      }
    }

    const supportsPersisted = typeof storage.persisted === 'function'
    const supportsPersist = typeof storage.persist === 'function'
    setIsPersistenceSupported(supportsPersisted || supportsPersist)

    if (supportsPersisted) {
      try {
        setPersistedStorage(await storage.persisted?.() ?? null)
      } catch {
        setPersistedStorage(null)
      }
    } else {
      setPersistedStorage(null)
    }
  }, [])

  const refreshRouteCacheStats = useCallback(async () => {
    try {
      setRouteCacheError(null)
      setRouteCacheStats(await getRouteCacheStats())
    } catch (caught) {
      setRouteCacheError(caught instanceof Error ? caught.message : '读取路线缓存统计失败。')
    }
  }, [])

  const refreshTicketCacheSummary = useCallback(async () => {
    try {
      setTicketCacheError(null)
      const trips = await listTrips()
      const summaries = await Promise.all(trips.map((trip) => getTicketBlobCacheSummary(trip.id)))
      setTicketCacheSummary(summaries.reduce<TicketCacheSummaryState>((total, summary) => ({
        cachedCount: total.cachedCount + summary.cachedCount,
        cachedSizeBytes: total.cachedSizeBytes + summary.cachedSizeBytes,
        clearableCount: total.clearableCount + summary.clearableCount,
        clearableSizeBytes: total.clearableSizeBytes + summary.clearableSizeBytes,
        totalCopyTickets: total.totalCopyTickets + summary.totalCopyTickets,
      }), {
        cachedCount: 0,
        cachedSizeBytes: 0,
        clearableCount: 0,
        clearableSizeBytes: 0,
        totalCopyTickets: 0,
      }))
    } catch (caught) {
      setTicketCacheError(caught instanceof Error ? caught.message : '读取票据缓存统计失败。')
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshStorageStatus(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshStorageStatus])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void getAccountAiPreferences().then((preferences) => {
        if (!cancelled) setAutoExpenseAiEnabled(preferences.autoExpenseAiEnabled)
      })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshTicketCacheSummary(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshTicketCacheSummary])

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  useEffect(() => {
    function refreshRoutingConfig() {
      setRoutingConfig(getRoutingConfig())
    }

    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutingConfig)
    window.addEventListener('storage', refreshRoutingConfig)
    return () => {
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutingConfig)
      window.removeEventListener('storage', refreshRoutingConfig)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshRouteCacheStats(), 0)
    function handleRouteCacheChanged() {
      void refreshRouteCacheStats()
    }

    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, handleRouteCacheChanged)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, handleRouteCacheChanged)
    }
  }, [refreshRouteCacheStats])

  async function handleRequestPersistence() {
    const storage = navigator.storage as PersistentStorageManager | undefined
    if (!storage?.persist) {
      setPersistenceMessage('当前浏览器不支持持久化本地存储请求。')
      return
    }

    setIsRequestingPersistence(true)
    setPersistenceMessage(null)
    try {
      const granted = await storage.persist()
      setPersistedStorage(granted)
      setPersistenceMessage(
        granted
          ? '浏览器已授予持久化本地存储；重要旅行仍可按需导出 zip 归档。'
          : '浏览器未授予持久化本地存储；重要旅行建议导出 zip 归档。',
      )
      await refreshStorageStatus()
    } catch (caught) {
      setPersistenceMessage(caught instanceof Error ? caught.message : '请求持久化本地存储失败。')
    } finally {
      setIsRequestingPersistence(false)
    }
  }

  async function handleClearSyncedTicketCaches() {
    if (!ticketCacheSummary?.clearableCount) return
    if (!window.confirm(`清理 ${ticketCacheSummary.clearableCount} 个已同步票据的此设备离线缓存？账号中的票据文件不会删除，可稍后重新同步。`)) return

    setIsClearingTicketCache(true)
    setTicketCacheError(null)
    setTicketCacheMessage(null)
    try {
      const trips = await listTrips()
      const results = await Promise.all(trips.map((trip) => clearSyncedTicketBlobCachesForTrip(trip.id)))
      const clearedCount = results.reduce((sum, result) => sum + result.clearedCount, 0)
      setTicketCacheMessage(`已清理 ${clearedCount} 个已同步票据离线缓存。`)
      await Promise.all([refreshTicketCacheSummary(), refreshStorageStatus()])
    } catch (caught) {
      setTicketCacheError(caught instanceof Error ? caught.message : '清理票据离线缓存失败。')
    } finally {
      setIsClearingTicketCache(false)
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      setError('请选择一个 zip 归档文件。')
      return
    }

    setIsImporting(true)
    setError(null)
    setSuccess(null)
    setWarnings([])
    try {
      const result = await importTripBackup(selectedFile)
      setSuccess(`已导入「${result.title}」，正在打开旅行总览。`)
      setWarnings(result.warnings)
      setSelectedFile(null)
      setFileInputKey((current) => current + 1)
      window.setTimeout(
        () => navigateTo('trip', { tripId: result.tripId }),
        result.warnings.length > 0 ? 2200 : 600,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入归档失败')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleTripPlanFileChange(file: File | null) {
    setSelectedTripPlanFile(file)
    setParsedTripPlan(null)
    setTripPlanSuccess(null)
    setTripPlanError(null)
    setSuccess(null)
    if (!file) return

    setIsParsingTripPlan(true)
    try {
      setParsedTripPlan(await parseTripPlanFile(file))
    } catch (caught) {
      setTripPlanError(caught instanceof Error ? caught.message : '解析 AI 行程包失败。')
    } finally {
      setIsParsingTripPlan(false)
    }
  }

  async function handleImportTripPlan() {
    if (!parsedTripPlan || !parsedTripPlan.validation.valid) {
      setTripPlanError('请先选择并通过校验一个 AI 行程包。')
      return
    }

    setIsImportingTripPlan(true)
    setTripPlanError(null)
    setError(null)
    setSuccess(null)
    setWarnings([])
    try {
      const result = await importTripPlanPackage(parsedTripPlan.package, {
        attachments: parsedTripPlan.attachments,
        sourceKind: parsedTripPlan.sourceKind,
      })
      setTripPlanSuccess(result)
      setSelectedTripPlanFile(null)
      setParsedTripPlan(null)
      setTripPlanFileInputKey((current) => current + 1)
    } catch (caught) {
      setTripPlanError(caught instanceof Error ? caught.message : '导入 AI 行程包失败。')
    } finally {
      setIsImportingTripPlan(false)
    }
  }

  async function handleCopyAiPrompt() {
    if (!navigator.clipboard?.writeText) {
      setCopyPromptMessage('当前浏览器不支持自动复制，请手动复制说明中的提示词。')
      return
    }

    try {
      await navigator.clipboard.writeText(AI_PROMPT_SNIPPET)
      setCopyPromptMessage('已复制提示词。')
    } catch {
      setCopyPromptMessage('当前浏览器不支持自动复制，请手动复制说明中的提示词。')
    }
  }

  function updateTravelProfile(patch: Partial<TravelProfile>) {
    setTravelProfile((current) => {
      const next = normalizeTravelProfile({ ...current, ...patch })
      saveTravelProfile(next)
      return next
    })
  }

  function updateAiPrivacySetting(key: keyof AiPrivacySettings, value: boolean) {
    setAiPrivacySettings((current) => {
      const next = { ...current, [key]: value }
      saveAiPrivacySettings(next)
      return getStoredAiPrivacySettings()
    })
  }

  function updateTravelInboxAutoRecognize(value: boolean) {
    setTravelInboxAutoRecognize(value)
    setTravelInboxAutoRecognizeEnabled(value)
  }

  async function updateAutoExpenseAi(value: boolean) {
    setAutoExpenseAiBusy(true)
    setAutoExpenseAiMessage('')
    try {
      const preferences = await saveAccountAiPreferences(value)
      setAutoExpenseAiEnabled(preferences.autoExpenseAiEnabled)
      setAutoExpenseAiMessage(value ? '已开启账号级账单 AI 自动补全。' : '已关闭账单 AI 自动补全。')
    } catch (caught) {
      setAutoExpenseAiMessage(caught instanceof Error ? caught.message : '保存设置失败。')
    } finally {
      setAutoExpenseAiBusy(false)
    }
  }

  async function handleApplyPwaUpdate() {
    setIsApplyingPwaUpdate(true)
    setPwaUpdateMessage('')
    try {
      const applied = await applyPendingPwaUpdate()
      setPwaUpdateMessage(applied ? '正在应用新版本。' : '当前没有可应用的新版本。')
    } catch {
      setPwaUpdateMessage('更新失败，请稍后重新打开应用。')
    } finally {
      setIsApplyingPwaUpdate(false)
    }
  }

  async function handleRouteCacheMaxBytesChange(bytes: number) {
    setIsUpdatingRouteCacheLimit(true)
    setRouteCacheError(null)
    try {
      await setRouteCacheMaxBytes(bytes)
      await refreshRouteCacheStats()
    } catch (caught) {
      setRouteCacheError(caught instanceof Error ? caught.message : '更新路线缓存上限失败。')
    } finally {
      setIsUpdatingRouteCacheLimit(false)
    }
  }

  async function handleClearRouteCache() {
    setIsClearingRouteCache(true)
    setRouteCacheError(null)
    try {
      await clearRouteCache()
      await refreshRouteCacheStats()
    } catch (caught) {
      setRouteCacheError(caught instanceof Error ? caught.message : '清理路线缓存失败。')
    } finally {
      setIsClearingRouteCache(false)
    }
  }

  return {
    aiPrivacySettings,
    appearanceMode,
    autoExpenseAiBusy,
    autoExpenseAiEnabled,
    autoExpenseAiMessage,
    contextTrip,
    copyPromptMessage,
    error,
    fileInputKey,
    handleApplyPwaUpdate,
    handleClearRouteCache,
    handleClearSyncedTicketCaches,
    handleCopyAiPrompt,
    handleImport,
    handleImportTripPlan,
    handleRequestPersistence,
    handleRouteCacheMaxBytesChange,
    handleTripPlanFileChange,
    isApplyingPwaUpdate,
    isClearingRouteCache,
    isClearingTicketCache,
    isImporting,
    isImportingTripPlan,
    isOnline,
    isParsingTripPlan,
    isPersistenceSupported,
    isRequestingPersistence,
    isUpdatingRouteCacheLimit,
    parsedTripPlan,
    persistedStorage,
    persistenceMessage,
    pwaLifecycle,
    pwaUpdateMessage,
    resolvedMode,
    routeCacheError,
    routeCacheStats,
    routingConfig,
    selectedFile,
    selectedTripPlanFile,
    setAppearanceMode,
    setSelectedFile,
    storageEstimate,
    success,
    ticketCacheError,
    ticketCacheMessage,
    ticketCacheSummary,
    travelInboxAutoRecognize,
    travelProfile,
    tripPlanError,
    tripPlanFileInputKey,
    tripPlanSuccess,
    updateAiPrivacySetting,
    updateAutoExpenseAi,
    updateTravelInboxAutoRecognize,
    updateTravelProfile,
    warnings,
  }
}

export type SettingsPageController = ReturnType<typeof useSettingsPageController>
