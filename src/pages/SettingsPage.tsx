import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileJson,
  Import,
  Monitor,
  Moon,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { AppVersion } from '../components/AppVersion'
import { Card } from '../components/ui/Card'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { CloudBackupPanel } from '../components/cloud/CloudBackupPanel'
import { Collapsible } from '../components/ui/Collapsible'
import { ImportRouteGenerationPanel } from '../components/trip/ImportRouteGenerationPanel'
import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SELECT_CLASS,
  FIELD_TEXTAREA_CLASS,
} from '../components/ui/FormField'
import { InlineStatus } from '../components/ui/InlineStatus'
import { ListRow } from '../components/ui/ListRow'
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
import {
  importTripBackup,
} from '../lib/backup'
import { getRouteParams, navigateTo } from '../lib/routes'
import { formatFileSize } from '../lib/tickets'
import {
  buildTripPlanPreviewSummary,
  importTripPlanPackage,
  parseTripPlanFile,
  type ImportTripPlanResult,
  type ParsedTripPlanFile,
} from '../lib/tripPlanImport'
import {
  ROUTE_CACHE_CHANGED_EVENT,
  clearRouteCache,
  getRouteCacheMaxByteOptions,
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
  type TravelPace,
  type TravelProfile,
  type TravelReminderLevel,
  type TravelTransportPreference,
} from '../lib/travelProfile'
import type { AppearanceMode } from '../lib/appearance'
import { useAppearance } from '../lib/appearanceContext'
import { usePwaLifecycleState } from '../hooks/usePwaLifecycleState'
import {
  applyPendingPwaUpdate,
  getPwaLifecycleStatusLabel,
  type PwaLifecycleStatus,
} from '../lib/pwaLifecycle'
import { listTrips } from '../db/repositories'
import {
  clearSyncedTicketBlobCachesForTrip,
  getTicketBlobCacheSummary,
} from '../lib/cloudObjectSync'

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

const AI_PROMPT_SNIPPET = `请只输出可被 JSON.parse 解析的 JSON，不要输出 Markdown 或解释。
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

const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: ReactNode }> = [
  { value: 'system', label: '跟随系统', icon: <Monitor className="size-4" /> },
  { value: 'light', label: '白天模式', icon: <Sun className="size-4" /> },
  { value: 'dark', label: '黑夜模式', icon: <Moon className="size-4" /> },
]

const paceOptions: Array<{ value: TravelPace; label: string; detail: string }> = [
  { value: 'relaxed', label: '轻松', detail: '少量重点' },
  { value: 'moderate', label: '适中', detail: '默认节奏' },
  { value: 'compact', label: '紧凑', detail: '更多安排' },
]

const transportOptions: Array<{ value: TravelTransportPreference; label: string }> = [
  { value: 'public_transport', label: '公共交通优先' },
  { value: 'walking', label: '步行为主' },
  { value: 'taxi', label: '可接受打车' },
  { value: 'mixed', label: '综合' },
]

const reminderLevelOptions: Array<{ value: TravelReminderLevel; label: string }> = [
  { value: 'quiet', label: '轻提醒' },
  { value: 'normal', label: '标准' },
  { value: 'detailed', label: '详细' },
]

const aiPrivacyGroups: Array<{
  title: string
  items: Array<{
    key: keyof AiPrivacySettings
    title: string
    description: string
    disabled?: boolean
  }>
}> = [
  {
    title: '基础行程',
    items: [
      {
        description: '行程标题、日期、时间和行程点标题。',
        key: 'allowItineraryBasics',
        title: '行程基础信息',
      },
      {
        description: '地点名称和地址；不包含精确经纬度。',
        key: 'allowLocationText',
        title: '地点名称和地址',
      },
      {
        description: '只表示是否有坐标或坐标是否异常，不包含完整坐标。',
        key: 'allowCoordinateState',
        title: '坐标状态',
      },
      {
        description: '交通方式、交通耗时是否存在，以及是否有交通备注。',
        key: 'allowTransportInfo',
        title: '交通信息',
      },
    ],
  },
  {
    title: '票据和备注',
    items: [
      {
        description: '票据数量、绑定状态和类型标签。',
        key: 'allowTicketMetadata',
        title: '票据元数据',
      },
      {
        description: '票据文件名或标题；默认关闭。',
        key: 'allowTicketFileNames',
        title: '票据文件名 / 标题',
      },
      {
        description: '仅表示备注是否存在和粗略长度。',
        key: 'allowNotesSummary',
        title: '备注摘要状态',
      },
      {
        description: '完整备注内容；默认关闭，当前本地检查不会读取。',
        key: 'allowFullNotes',
        title: '完整备注内容',
      },
      {
        description: '后续支持。当前不可开启，也不会读取图片、PDF 或文件正文。',
        disabled: true,
        key: 'allowTicketFileContent',
        title: '票据图片/PDF 内容',
      },
      {
        description: '云端同步状态；默认不发送给 AI。',
        key: 'allowCloudSyncStatus',
        title: '云端同步状态',
      },
    ],
  },
]

export function SettingsPage() {
  const { mode: appearanceMode, resolvedMode, setMode: setAppearanceMode } = useAppearance()
  const pwaLifecycle = usePwaLifecycleState()
  const routeParams = getRouteParams()
  const shouldOpenCloudBackup = routeParams.get('section') === 'cloud'
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
    if (!ticketCacheSummary?.clearableCount) {
      return
    }
    if (!window.confirm(`清理 ${ticketCacheSummary.clearableCount} 个已同步票据的此设备离线缓存？账号中的票据文件不会删除，可稍后重新同步。`)) {
      return
    }

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
    if (!file) {
      return
    }

    setIsParsingTripPlan(true)
    try {
      const parsed = await parseTripPlanFile(file)
      setParsedTripPlan(parsed)
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

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-40 pt-24">
      <div className="mb-2">
        <p className="text-sm font-semibold text-primary">控制中心</p>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
          设置
        </h2>
      </div>

      {error || success || warnings.length > 0 ? (
        <Card variant="grouped" className="space-y-3">
          {error ? <StatusMessage tone="error" message={error} /> : null}
          {success ? <StatusMessage tone="success" message={success} /> : null}
          {warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
              <p className="font-semibold">导入/导出提醒</p>
              <ul className="mt-1 list-inside list-disc">
                {warnings.map((warning) => (
                  <li className="break-words [overflow-wrap:anywhere]" key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Collapsible subtitle={`当前：${resolvedMode === 'dark' ? '黑夜' : '白天'}`} title="外观">
        <Card variant="grouped" className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
              <Monitor className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">外观</h3>
              <p className="mt-1 text-sm leading-6 tm-muted">当前是{resolvedMode === 'dark' ? '黑夜' : '白天'}。</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="外观模式">
            {appearanceOptions.map((option) => {
              const active = appearanceMode === option.value
              return (
                <button
                  aria-pressed={active}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg px-2 text-center text-xs font-semibold transition active:scale-[0.98] tm-focus ${
                    active
                      ? 'bg-primary text-white shadow-[0_6px_16px_var(--color-primary-shadow)]'
                      : 'bg-surface-container-high text-on-surface-variant ring-1 ring-outline-variant/70'
                  }`}
                  data-testid={`appearance-mode-${option.value}`}
                  key={option.value}
                  onClick={() => setAppearanceMode(option.value)}
                  type="button"
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        </Card>
      </Collapsible>

      <Collapsible subtitle="节奏、交通和提醒" title="旅行偏好">
        <TravelProfileSettings
          onChange={updateTravelProfile}
          profile={travelProfile}
        />
      </Collapsible>

      <Collapsible subtitle="AI 可读取哪些内容" title="AI 与隐私">
        <AiPrivacySettingsPanel
          autoExpenseAiBusy={autoExpenseAiBusy}
          autoExpenseAiEnabled={autoExpenseAiEnabled}
          autoExpenseAiMessage={autoExpenseAiMessage}
          onChange={updateAiPrivacySetting}
          onAutoExpenseAiChange={(value) => void updateAutoExpenseAi(value)}
          onTravelInboxAutoRecognizeChange={updateTravelInboxAutoRecognize}
          settings={aiPrivacySettings}
          travelInboxAutoRecognize={travelInboxAutoRecognize}
        />
      </Collapsible>

      <Collapsible subtitle="主屏幕、版本和离线状态" title="安装与离线">
        <Card variant="grouped" className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
              <Smartphone className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">主屏幕 App</h3>
              <p className="mt-1 text-sm leading-6 tm-muted">Safari 分享菜单里添加到主屏幕。</p>
            </div>
          </div>

          <div className="grid gap-2">
            <InfoPill
              icon={<RefreshCw className="size-4" />}
              text={`应用更新：${getPwaLifecycleStatusLabel(pwaLifecycle.status)}`}
              tone={getPwaLifecycleTone(pwaLifecycle.status)}
            />
            <InfoPill
              icon={<Smartphone className="size-4" />}
              text={`当前版本：v${pwaLifecycle.appVersion}`}
            />
            <InfoPill
              icon={isOnline ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
              text={isOnline ? '当前在线' : '当前离线'}
              tone={isOnline ? 'success' : 'warning'}
            />
            <InfoPill
              icon={<Database className="size-4" />}
              text="旅行先保存在此设备；登录后自动同步。"
            />
            <InfoPill
              icon={<AlertTriangle className="size-4" />}
              text="地图和外部路线需要网络。"
              tone="warning"
            />
          </div>

          {pwaLifecycle.message ? (
            <InlineStatus tone={pwaLifecycle.status === 'error' ? 'error' : 'neutral'}>
              {pwaLifecycle.message}
            </InlineStatus>
          ) : null}

          {pwaLifecycle.status === 'update-ready' ? (
            <Button
              className="w-full"
              icon={<RefreshCw className="size-4" />}
              loading={isApplyingPwaUpdate}
              onClick={() => void handleApplyPwaUpdate()}
              variant="secondary"
            >
              更新并重启
            </Button>
          ) : null}

          {pwaUpdateMessage ? (
            <InlineStatus role="status" tone="success">
              {pwaUpdateMessage}
            </InlineStatus>
          ) : null}
        </Card>
      </Collapsible>

      <Collapsible
        defaultOpen={shouldOpenCloudBackup}
        key={shouldOpenCloudBackup ? 'cloud-open' : 'cloud'}
        subtitle="账号同步、队列和冲突"
        title="云端同步"
      >
        <CloudBackupPanel trip={null} />
      </Collapsible>

      <Collapsible subtitle="导入、恢复、迁移" title="高级与迁移">
        <Card variant="grouped" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50/80 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50">
              <Import className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">导入 zip 归档</h3>
              <p className="text-sm tm-muted">选择之前导出的 zip。</p>
            </div>
          </div>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>归档文件</span>
            <input
              accept=".zip,application/zip,application/x-zip-compressed"
              className="mt-2 block w-full tm-field px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-fixed file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary dark:text-slate-200 dark:file:bg-primary/15 dark:file:text-primary-fixed-dim"
              key={fileInputKey}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          {selectedFile ? (
            <p className="rounded-xl bg-slate-50/75 px-3 py-2 text-xs tm-muted ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70">
              已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}
            </p>
          ) : null}

          <Button
            className="w-full"
            disabled={!selectedFile}
            icon={<Import className="size-4" />}
            loading={isImporting}
            onClick={() => void handleImport()}
            variant="secondary"
          >
            导入 zip 归档
          </Button>
        </Card>
      </Collapsible>

      <Collapsible subtitle="生成或导入行程" title="AI 生成行程">
        <Card variant="grouped" className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50/80 text-violet-600 ring-1 ring-violet-100/80 dark:bg-violet-950/35 dark:text-violet-300 dark:ring-violet-900/50">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">AI 行程包与应用内生成</h3>
              <p className="mt-1 text-sm leading-6 tm-muted">生成新行程，或导入 trip-plan.json / zip。</p>
            </div>
          </div>

          <div className="grid gap-2">
            <InfoPill
              icon={<FileJson className="size-4" />}
              text="AI 行程包用于新建旅行。"
            />
            <InfoPill
              icon={<Sparkles className="size-4" />}
              text="订单和票据追加到现有旅行，请用旅行收件箱。"
            />
            <InfoPill
              icon={<AlertTriangle className="size-4" />}
              text="导入前核对日期、地点、坐标和交通。"
              tone="warning"
            />
          </div>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>AI 行程包文件</span>
            <input
              aria-label="选择 AI 行程包文件"
              accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
              className="mt-2 block w-full tm-field px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-secondary-container file:px-3 file:py-2 file:text-sm file:font-semibold file:text-secondary dark:text-slate-200 dark:file:bg-secondary/15 dark:file:text-secondary-fixed-dim"
              data-testid="ai-trip-plan-file-input"
              key={tripPlanFileInputKey}
              onChange={(event) => void handleTripPlanFileChange(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          {selectedTripPlanFile ? (
            <p className="rounded-xl bg-slate-50/75 px-3 py-2 text-xs tm-muted ring-1 ring-slate-100/70 [overflow-wrap:anywhere] dark:bg-slate-900/40 dark:ring-slate-800/70">
              已选择：{selectedTripPlanFile.name} · {formatFileSize(selectedTripPlanFile.size)}
            </p>
          ) : null}

          {isParsingTripPlan ? <SkeletonLine className="w-full" /> : null}

          {tripPlanError ? <StatusMessage tone="error" message={tripPlanError} /> : null}

          {parsedTripPlan ? <TripPlanPreview parsed={parsedTripPlan} /> : null}

          <Button
            className="w-full"
            data-testid="ai-trip-plan-import-button"
            disabled={!parsedTripPlan?.validation.valid}
            icon={<Sparkles className="size-4" />}
            loading={isImportingTripPlan}
            onClick={() => void handleImportTripPlan()}
            variant="secondary"
          >
            {getTripPlanImportButtonLabel(parsedTripPlan)}
          </Button>

          {tripPlanSuccess ? <TripPlanSuccessCard result={tripPlanSuccess} /> : null}

          <TripPlanGuide
            copyMessage={copyPromptMessage}
            onCopyPrompt={() => void handleCopyAiPrompt()}
          />

          <p className="pt-1 text-center">
            <button
              type="button"
              className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-primary underline underline-offset-2"
              onClick={() => navigateTo('ai-draft')}
            >
              打开 AI 生成行程 →
            </button>
          </p>
        </Card>
      </Collapsible>

      <Collapsible subtitle="路线服务与缓存" title="路线服务">
        <RouteServiceSettings
          config={routingConfig}
          cacheError={routeCacheError}
          cacheStats={routeCacheStats}
          isClearingCache={isClearingRouteCache}
          isUpdatingCacheLimit={isUpdatingRouteCacheLimit}
          onCacheMaxBytesChange={(bytes) => void handleRouteCacheMaxBytesChange(bytes)}
          onClearCache={() => void handleClearRouteCache()}
        />
      </Collapsible>

      <Collapsible subtitle="离线缓存和持久化" title="设备存储">
        <Card variant="grouped" className="space-y-3">
          <div className="divide-y divide-slate-100 py-1">
            <ListRow
              detail={
                storageEstimate
                  ? `已用 ${formatStorageSize(storageEstimate.usage)} / 配额 ${formatStorageSize(
                      storageEstimate.quota,
                    )}`
                  : '当前浏览器不支持存储估算'
              }
              icon={<Database className="size-5" />}
              title="存储估算"
            />
            <ListRow
              detail={getPersistenceDetail(isPersistenceSupported, persistedStorage)}
              icon={<ShieldCheck className="size-5" />}
              title="持久化存储"
            />
            <ListRow
              detail="当前设备可离线查看已缓存旅行和票据；清除浏览器数据、私密浏览、系统清理或长期未使用都可能移除这些缓存。"
              icon={<Smartphone className="size-5" />}
              title="此设备离线缓存"
            />
            <ListRow
              detail={
                ticketCacheSummary
                  ? `${ticketCacheSummary.cachedCount} 个票据缓存，占用 ${formatStorageSize(ticketCacheSummary.cachedSizeBytes)}；其中 ${ticketCacheSummary.clearableCount} 个已同步可清理。`
                  : ticketCacheError ?? '正在统计票据缓存'
              }
              icon={<FileJson className="size-5" />}
              title="票据离线缓存"
            />
          </div>

          <Button
            className="w-full"
            disabled={!ticketCacheSummary?.clearableCount || isClearingTicketCache}
            icon={<RefreshCw className="size-4" />}
            loading={isClearingTicketCache}
            onClick={() => void handleClearSyncedTicketCaches()}
            variant="secondary"
          >
            清理已同步票据缓存
          </Button>

          <Button
            className="w-full"
            disabled={!isPersistenceSupported || persistedStorage === true}
            icon={<RefreshCw className="size-4" />}
            loading={isRequestingPersistence}
            onClick={() => void handleRequestPersistence()}
            variant="secondary"
          >
            请求持久化本地存储
          </Button>

          {persistenceMessage ? (
            <p className="rounded-xl bg-slate-50/75 px-3 py-2 text-xs leading-5 tm-muted ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70">
              {persistenceMessage}
            </p>
          ) : null}
          {ticketCacheMessage ? (
            <p className="rounded-xl bg-emerald-50/75 px-3 py-2 text-xs leading-5 text-emerald-800 ring-1 ring-emerald-100/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50">
              {ticketCacheMessage}
            </p>
          ) : null}
          {ticketCacheError ? (
            <p className="rounded-xl bg-red-50/75 px-3 py-2 text-xs leading-5 text-red-700 ring-1 ring-red-100/70 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50">
              {ticketCacheError}
            </p>
          ) : null}
        </Card>
      </Collapsible>

      <Collapsible subtitle="版本信息与离线缓存提醒" title="关于">
        <Card className="space-y-3 border-amber-100 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/25">
          <div>
            <h3 className="text-base font-semibold text-amber-950 dark:text-amber-200">离线缓存提醒</h3>
            <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-300">
              旅行会先写入此设备离线缓存。即使浏览器授予持久化存储，iOS Safari
              在存储压力、清除数据、私密浏览或长期未使用时仍可能清理离线缓存；zip 归档可作为高级迁移或手动留存工具。
            </p>
          </div>
          <div className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-950/35">
            <AppVersion className="text-left text-amber-800/70" label="当前版本" />
          </div>
        </Card>
      </Collapsible>
    </div>
  )
}

function TravelProfileSettings({
  profile,
  onChange,
}: {
  profile: TravelProfile
  onChange: (patch: Partial<TravelProfile>) => void
}) {
  return (
    <section className="space-y-3" data-testid="travel-profile-section">
      <Card variant="grouped" className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary ring-1 ring-primary/10 dark:bg-primary/15 dark:text-primary-fixed-dim">
            <Route className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">旅行偏好</h3>
            <p className="mt-1 text-sm leading-6 tm-muted">给 AI 和本地提醒参考。</p>
          </div>
        </div>

        <div className="grid gap-2">
          <InfoPill
            icon={<ShieldCheck className="size-4" />}
            text="本地检查只在设备内运行。"
            tone="success"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">旅行节奏</p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="旅行节奏">
            {paceOptions.map((option) => (
              <OptionButton
                active={profile.pace === option.value}
                detail={option.detail}
                key={option.value}
                label={option.label}
                onClick={() => onChange({ pace: option.value })}
                testId={`travel-profile-pace-${option.value}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">交通偏好</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="交通偏好">
            {transportOptions.map((option) => (
              <OptionButton
                active={profile.preferTransport === option.value}
                key={option.value}
                label={option.label}
                onClick={() => onChange({ preferTransport: option.value })}
                testId={`travel-profile-transport-${option.value}`}
              />
            ))}
          </div>
        </div>

        <ToggleRow
          checked={profile.mealTimeProtection}
          description="建议行程时尽量保留吃饭时间。"
          onChange={(checked) => onChange({ mealTimeProtection: checked })}
          testId="travel-profile-meal-protection"
          title="保护饭点"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>希望几点后开始</span>
            <input
              className={FIELD_INPUT_CLASS}
              data-testid="travel-profile-morning-start"
              onChange={(event) => onChange({ morningStartAfter: event.target.value || undefined })}
              type="time"
              value={profile.morningStartAfter ?? ''}
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>希望几点前结束</span>
            <input
              className={FIELD_INPUT_CLASS}
              data-testid="travel-profile-night-return"
              onChange={(event) => onChange({ nightReturnBefore: event.target.value || undefined })}
              type="time"
              value={profile.nightReturnBefore ?? ''}
            />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">提醒强度</p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="提醒强度">
            {reminderLevelOptions.map((option) => (
              <OptionButton
                active={profile.reminderLevel === option.value}
                key={option.value}
                label={option.label}
                onClick={() => onChange({ reminderLevel: option.value })}
                testId={`travel-profile-reminder-${option.value}`}
              />
            ))}
          </div>
        </div>

        <p className="rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted ring-1 ring-outline-variant/70">
          当前只影响安排密度和提醒强度。
        </p>
      </Card>
    </section>
  )
}

function AiPrivacySettingsPanel({
  autoExpenseAiBusy,
  autoExpenseAiEnabled,
  autoExpenseAiMessage,
  settings,
  onChange,
  onAutoExpenseAiChange,
  onTravelInboxAutoRecognizeChange,
  travelInboxAutoRecognize,
}: {
  autoExpenseAiBusy: boolean
  autoExpenseAiEnabled: boolean
  autoExpenseAiMessage: string
  settings: AiPrivacySettings
  onChange: (key: keyof AiPrivacySettings, value: boolean) => void
  onAutoExpenseAiChange: (value: boolean) => void
  onTravelInboxAutoRecognizeChange: (value: boolean) => void
  travelInboxAutoRecognize: boolean
}) {
  return (
    <section className="space-y-3" data-testid="ai-privacy-section">
      <Card variant="grouped" className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary ring-1 ring-primary/10 dark:bg-primary/15 dark:text-primary-fixed-dim">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">AI 与隐私</h3>
            <p className="mt-1 text-sm leading-6 tm-muted">控制 AI 可以读取的范围。</p>
          </div>
        </div>

        <div className="grid gap-2">
          <InfoPill
            icon={<Sparkles className="size-4" />}
            text="本地检查只读。"
            tone="success"
          />
          <InfoPill
            icon={<AlertTriangle className="size-4" />}
            text="收件箱只在你开启或确认后发送提取文本。"
            tone="warning"
          />
        </div>

        {aiPrivacyGroups.map((group) => (
          <div className="space-y-2" key={group.title}>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{group.title}</p>
            <div className="grid gap-2">
              {group.items.map((item) => (
                <ToggleRow
                  checked={item.disabled ? false : settings[item.key]}
                  description={item.description}
                  disabled={item.disabled}
                  key={item.key}
                  onChange={(checked) => onChange(item.key, checked)}
                  testId={`ai-privacy-${item.key}`}
                  title={item.title}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">旅行收件箱</p>
          <ToggleRow
            checked={travelInboxAutoRecognize}
            description="开启后，新材料提取完成会自动交给 AI 识别。原始文件不上传。"
            onChange={onTravelInboxAutoRecognizeChange}
            testId="travel-inbox-auto-recognize-setting"
            title="提取后自动 AI 识别"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">旅行账单档案</p>
          <ToggleRow
            checked={autoExpenseAiEnabled}
            description="本地规则不够时，用脱敏文本补全候选字段。"
            disabled={autoExpenseAiBusy}
            onChange={onAutoExpenseAiChange}
            testId="ledger-auto-ai-setting"
            title="账号级自动 AI 识别"
          />
          {autoExpenseAiMessage ? <p className="text-xs tm-muted">{autoExpenseAiMessage}</p> : null}
        </div>

        <p className="rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted ring-1 ring-outline-variant/70">
          隐私开关保存在当前浏览器；账单 AI 授权登录后同步到账号。
        </p>
      </Card>
    </section>
  )
}

function OptionButton({
  active,
  detail,
  label,
  onClick,
  testId,
}: {
  active: boolean
  detail?: string
  label: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-center text-xs font-semibold transition active:scale-[0.98] tm-focus ${
        active
          ? 'bg-primary text-white shadow-[0_6px_16px_var(--color-primary-shadow)]'
          : 'bg-surface-container-high text-on-surface-variant ring-1 ring-outline-variant/70'
      }`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      {detail ? <span className={`text-[11px] font-medium ${active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>{detail}</span> : null}
    </button>
  )
}

function ToggleRow({
  checked,
  description,
  disabled = false,
  onChange,
  testId,
  title,
}: {
  checked: boolean
  description: string
  disabled?: boolean
  onChange: (checked: boolean) => void
  testId: string
  title: string
}) {
  return (
    <button
      aria-checked={checked}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-outline-variant/70 bg-surface-container-high px-3 py-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 tm-focus"
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-on-surface">{title}</span>
        <span className="mt-1 block text-xs leading-5 tm-muted">{description}</span>
      </span>
      <span
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? 'justify-end bg-primary' : 'justify-start bg-slate-200 dark:bg-slate-700'
        }`}
        aria-hidden="true"
      >
        <span className="size-5 rounded-full bg-white shadow-sm dark:bg-slate-100" />
      </span>
    </button>
  )
}

function RouteServiceSettings({
  config,
  cacheStats,
  cacheError,
  isClearingCache,
  isUpdatingCacheLimit,
  onCacheMaxBytesChange,
  onClearCache,
}: {
  config: RoutingConfig
  cacheStats: RouteCacheStats | null
  cacheError: string | null
  isClearingCache: boolean
  isUpdatingCacheLimit: boolean
  onCacheMaxBytesChange: (bytes: number) => void
  onClearCache: () => void
}) {
  const configLabel = getRoutingConfigLabel(config)
  const maxOptions = getRouteCacheMaxByteOptions()

  return (
    <section className="space-y-3" data-testid="routing-settings-section">
      <Card variant="grouped" className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary ring-1 ring-primary/10 dark:bg-primary/15 dark:text-primary-fixed-dim">
            <Route className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">路线服务</h3>
            <p className="mt-1 text-sm leading-6 tm-muted">用于生成道路路线。</p>
          </div>
        </div>

        <div className="grid gap-2">
          <InfoPill
            icon={<AlertTriangle className="size-4" />}
            text="生成路线会发送相邻地点坐标。"
            tone="warning"
          />
        </div>

        <div className="rounded-xl bg-slate-50/75 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:text-slate-300 dark:ring-slate-800/70">
          当前状态：<span className="font-semibold text-slate-800 dark:text-slate-100">{configLabel}</span>
        </div>

        <p className="text-xs leading-5 tm-muted">服务密钥由旅图后端管理。</p>

        <div className="space-y-3 rounded-lg border border-outline-variant/70 bg-surface-container-high p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">路线缓存</h4>
              <p className="mt-1 text-xs leading-5 tm-muted">只缓存路线，不缓存地图瓦片。</p>
            </div>
            <span
              className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold text-on-surface-variant ring-1 ring-outline-variant/70"
              data-testid="route-cache-count"
            >
              {cacheStats ? `${cacheStats.count} 条` : '读取中'}
            </span>
          </div>

          <div
            className="rounded-xl bg-white/90 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100 dark:bg-slate-950/55 dark:text-slate-300 dark:ring-slate-800"
            data-testid="route-cache-stats"
          >
            {cacheStats ? (
              <>
                当前缓存：<span className="font-semibold text-slate-900 dark:text-slate-100">{formatFileSize(cacheStats.totalSizeBytes)}</span>
                <span className="text-slate-400 dark:text-slate-500"> / </span>
                上限 <span className="font-semibold text-slate-900 dark:text-slate-100">{formatFileSize(cacheStats.maxBytes)}</span>
              </>
            ) : (
              '正在读取路线缓存统计…'
            )}
          </div>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>缓存上限</span>
            <select
              className={FIELD_SELECT_CLASS}
              data-testid="route-cache-max-select"
              disabled={isUpdatingCacheLimit}
              onChange={(event) => onCacheMaxBytesChange(Number(event.target.value))}
              value={cacheStats?.maxBytes ?? DEFAULT_ROUTE_CACHE_MAX_BYTES_FALLBACK}
            >
              {maxOptions.map((bytes) => (
                <option key={bytes} value={bytes}>
                  {formatFileSize(bytes)}
                </option>
              ))}
            </select>
          </label>

          <Button
            className="w-full"
            data-testid="route-cache-clear"
            loading={isClearingCache}
            onClick={onClearCache}
            variant="secondary"
          >
            清理路线缓存
          </Button>

          {cacheError ? (
            <p className="break-words rounded-xl bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-700 ring-1 ring-amber-100/80 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50">
              {cacheError}
            </p>
          ) : null}
        </div>
      </Card>
    </section>
  )
}

const DEFAULT_ROUTE_CACHE_MAX_BYTES_FALLBACK = 20 * 1024 * 1024

function getRoutingConfigLabel(config: RoutingConfig) {
  if (config.configured && config.source === 'proxy') {
    return '路线服务由旅图提供'
  }
  if (config.configured && config.source === 'local') {
    return '路线服务由旅图提供'
  }
  if (config.configured && config.source === 'env') {
    return '路线服务由旅图提供'
  }
  return '路线服务暂不可用'
}

function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return (
    <InlineStatus role={tone === 'error' ? 'alert' : 'status'} size="md" tone={tone}>
      {message}
    </InlineStatus>
  )
}

function TripPlanGuide({
  copyMessage,
  onCopyPrompt,
}: {
  copyMessage: string | null
  onCopyPrompt: () => void
}) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-violet-100/80 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/25"
      data-testid="ai-trip-plan-guide"
    >
      <div>
        <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">AI 行程包使用说明</h4>
        <p className="mt-1 text-sm leading-6 tm-muted">
          旅图不会调用 AI，只导入你上传的 JSON / zip。AI 生成的地点、坐标和交通时间都需要人工核对。
        </p>
      </div>

      <div className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        <p>
          <span className="font-semibold text-slate-800 dark:text-slate-100">JSON 单文件</span>
          ：适合导入行程、地图坐标、交通段，以及 reference / external 票据。
        </p>
        <p>
          <span className="font-semibold text-slate-800 dark:text-slate-100">zip 行程包</span>
          ：适合导入行程和 copy 附件。copy 模式必须使用 zip，并通过 filePath 指向 files/ 内附件。
        </p>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl bg-white/80 p-3 dark:bg-slate-950/50">
        <pre className="min-w-max text-xs leading-5 text-slate-600 dark:text-slate-300">{`trip-plan.zip
├── trip-plan.json
└── files/
    ├── hotel-confirmation.pdf
    └── museum-ticket.png`}</pre>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">可复制给外部 AI 的简化提示词</p>
        <textarea
          aria-label="可复制给外部 AI 的简化提示词"
          className={`${FIELD_TEXTAREA_CLASS} min-h-40 resize-y border-violet-100 font-mono text-xs leading-5 dark:border-violet-900/50`}
          data-testid="ai-trip-plan-prompt-text"
          readOnly
          value={AI_PROMPT_SNIPPET}
        />
        <Button
          className="w-full"
          data-testid="ai-trip-plan-copy-prompt"
          icon={<Copy className="size-4" />}
          onClick={onCopyPrompt}
          variant="secondary"
        >
          复制给 AI 的提示词
        </Button>
        {copyMessage ? (
          <p className="rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold leading-5 text-violet-700 dark:bg-slate-950/50 dark:text-violet-300">
            {copyMessage}
          </p>
        ) : null}
      </div>

      <p className="text-xs leading-5 tm-muted">
        完整技术规范请查看 GitHub 仓库 docs/AI_IMPORT_SPEC.md 和 docs/AI_PROMPT_TEMPLATE.md。
      </p>
    </div>
  )
}

function TripPlanPreview({ parsed }: { parsed: ParsedTripPlanFile }) {
  const summary = buildTripPlanPreviewSummary(parsed.validation)
  const trip = parsed.package.trip
  const hasErrors = parsed.validation.errors.length > 0
  const hasWarnings = parsed.validation.warnings.length > 0

  return (
    <div
      className="space-y-3 rounded-2xl border border-violet-100/80 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/25"
      data-testid="ai-trip-plan-preview"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/90 text-violet-600 ring-1 ring-violet-100/80 dark:bg-slate-950/55 dark:text-violet-300 dark:ring-violet-900/50">
          <FileJson className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-violet-600 dark:text-violet-300">
            {parsed.sourceKind === 'zip' ? 'zip 行程包' : 'JSON 行程包'}
          </p>
          <h4 className="mt-1 truncate text-base font-semibold text-slate-950 dark:text-slate-100">
            {trip?.title || '未命名旅行'}
          </h4>
          <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
            {trip?.destination || '目的地未填写'} · {trip?.startDate || '开始日期未定'} - {trip?.endDate || '结束日期未定'}
          </p>
        </div>
      </div>

      <TripPlanValidationStatus
        hasErrors={hasErrors}
        hasWarnings={hasWarnings}
      />

      <div className="grid grid-cols-2 gap-2">
        <PreviewMetric label="Day" value={summary.daysCount} />
        <PreviewMetric label="行程点" value={summary.itemsCount} />
        <PreviewMetric label="有坐标" value={summary.geocodedItemsCount} />
        <PreviewMetric label="缺坐标" value={summary.missingCoordinateCount} />
        <PreviewMetric label="票据" value={summary.ticketCount} />
        <PreviewMetric label="copy 附件" value={summary.attachmentCount} />
        <PreviewMetric label="reference" value={summary.referenceTicketCount} />
        <PreviewMetric label="external" value={summary.externalTicketCount} />
      </div>

      {hasErrors ? (
        <ValidationList
          description="以下问题会阻止导入，请修改 JSON 或 zip 后重新选择文件。"
          testId="ai-trip-plan-errors"
          items={parsed.validation.errors}
          title="必须修复"
          tone="error"
        />
      ) : null}

      {hasWarnings ? (
        <ValidationList
          description="以下问题不会阻止导入，但建议导入后逐项核对。"
          testId="ai-trip-plan-warnings"
          items={parsed.validation.warnings}
          title="建议检查"
          tone="warning"
        />
      ) : null}

      {parsed.validation.valid ? (
        <p className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs font-semibold leading-5 text-emerald-700 ring-1 ring-emerald-100/80 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50" role="status">
          可导入：将创建一个新的本地旅行，不会覆盖现有数据。
        </p>
      ) : null}
    </div>
  )
}

function TripPlanSuccessCard({ result }: { result: ImportTripPlanResult }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-100/80 bg-emerald-50/80 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/25"
      data-testid="ai-trip-plan-success-checklist"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/90 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-slate-950/55 dark:text-emerald-300 dark:ring-emerald-900/50">
          <CheckCircle2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">已导入</p>
          <h4 className="mt-1 break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">
            {result.title}
          </h4>
        </div>
      </div>

      <div className="rounded-xl bg-white/80 px-3 py-3 text-sm leading-6 text-emerald-900 dark:bg-slate-950/45 dark:text-emerald-200">
        <p className="font-semibold">建议检查</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>地图坐标是否准确</li>
          <li>可生成路线的日程是否需要批量生成路线预览</li>
          <li>票据是否绑定到正确行程点</li>
          <li>重要旅行可导出完整 zip 归档</li>
        </ol>
      </div>

      <ImportRouteGenerationPanel tripId={result.tripId} />

      {result.warnings.length > 0 ? (
        <ValidationList
          description="导入已完成，但这些内容仍建议核对。"
          items={result.warnings}
          testId="ai-trip-plan-success-warnings"
          title="建议检查"
          tone="warning"
        />
      ) : null}

      <Button
        className="w-full"
        onClick={() => navigateTo('trip', { tripId: result.tripId })}
      >
        进入旅行工作台
      </Button>
    </div>
  )
}

function getTripPlanImportButtonLabel(parsed: ParsedTripPlanFile | null) {
  if (!parsed) {
    return '确认导入 AI 行程包'
  }
  if (parsed.validation.errors.length > 0) {
    return '有必须修复，无法导入'
  }
  if (parsed.validation.warnings.length > 0) {
    return '有建议检查，仍然导入'
  }
  return '确认导入'
}

function TripPlanValidationStatus({
  hasErrors,
  hasWarnings,
}: {
  hasErrors: boolean
  hasWarnings: boolean
}) {
  const status = hasErrors
    ? {
        className: 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300',
        text: '有必须修复，无法导入',
      }
    : hasWarnings
      ? {
          className: 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-300',
          text: '有建议检查，可导入',
        }
      : {
          className: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-300',
          text: '可导入',
        }

  return (
    <div
      aria-live="polite"
      className={`rounded-xl border px-3 py-2 text-sm font-semibold ${status.className}`}
      data-testid="ai-trip-plan-validation-status"
    >
      {status.text}
    </div>
  )
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-white/70 dark:bg-slate-950/45 dark:ring-slate-800/70">
      <p className="text-lg font-semibold text-slate-950 dark:text-slate-100">{value}</p>
      <p className="text-xs tm-muted">{label}</p>
    </div>
  )
}

function ValidationList({
  description,
  items,
  testId,
  title,
  tone,
}: {
  description: string
  items: string[]
  testId: string
  title: string
  tone: 'error' | 'warning'
}) {
  const styles =
    tone === 'error'
      ? 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300'
      : 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-300'

  return (
    <div className={`rounded-xl border px-3 py-3 text-sm leading-6 ${styles}`} data-testid={testId}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5">{description}</p>
      <ul className="mt-2 list-outside list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li className="break-words [overflow-wrap:anywhere]" key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function InfoPill({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: ReactNode
  text: string
  tone?: 'neutral' | 'success' | 'warning'
}) {
  const styles = {
    neutral: 'bg-surface-container-high text-on-surface-variant ring-1 ring-outline-variant/70',
    success: 'bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-100/80 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50',
    warning: 'bg-amber-50/80 text-amber-800 ring-1 ring-amber-100/80 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50',
  }[tone]

  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-6 ${styles}`}>
      <span className="mt-1 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

function getPersistenceDetail(isSupported: boolean, persisted: boolean | null) {
  if (!isSupported) {
    return '当前浏览器不支持持久化存储状态查询'
  }

  if (persisted === true) {
    return '已获得持久化存储许可，重要旅行仍可按需导出 zip 归档'
  }

  if (persisted === false) {
    return '尚未获得持久化存储许可'
  }

  return '持久化存储状态未知'
}

function getPwaLifecycleTone(status: PwaLifecycleStatus): 'neutral' | 'success' | 'warning' {
  if (status === 'registered' || status === 'offline-ready') {
    return 'success'
  }

  if (status === 'error' || status === 'unsupported' || status === 'update-ready') {
    return 'warning'
  }

  return 'neutral'
}

function formatStorageSize(size?: number) {
  if (size === undefined || Number.isNaN(size)) {
    return '未知'
  }

  return formatFileSize(size)
}
