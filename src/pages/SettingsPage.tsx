import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileJson,
  Import,
  KeyRound,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { AppVersion } from '../components/AppVersion'
import { Card } from '../components/ui/Card'
import { Collapsible } from '../components/ui/Collapsible'
import { ListRow } from '../components/ui/ListRow'
import { SectionHeader } from '../components/ui/SectionHeader'
import {
  importTripBackup,
} from '../lib/backup'
import { navigateTo } from '../lib/routes'
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
  clearLocalOpenRouteServiceApiKey,
  getLocalOpenRouteServiceApiKey,
  getRoutingConfig,
  saveLocalOpenRouteServiceApiKey,
  type RoutingConfig,
} from '../lib/routing'
import {
  GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT as GOOGLE_MAPS_CONFIG_CHANGED_EVENT,
  clearGoogleMapsApiKey,
  getGoogleMapsApiKey,
  isGoogleMapsConfigured,
  saveGoogleMapsApiKey,
} from '../lib/googleMaps'

type StorageEstimateState = {
  usage?: number
  quota?: number
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

export function SettingsPage() {
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
  const [routingKeyInput, setRoutingKeyInput] = useState(() => getLocalOpenRouteServiceApiKey())
  const [routingMessage, setRoutingMessage] = useState<string | null>(null)
  const [googleMapsKeyInput, setGoogleMapsKeyInput] = useState(() => getGoogleMapsApiKey())
  const [googleMapsConfigured, setGoogleMapsConfigured] = useState(() => isGoogleMapsConfigured())
  const [googleMapsMessage, setGoogleMapsMessage] = useState<string | null>(null)
  const [routeCacheStats, setRouteCacheStats] = useState<RouteCacheStats | null>(null)
  const [routeCacheError, setRouteCacheError] = useState<string | null>(null)
  const [isClearingRouteCache, setIsClearingRouteCache] = useState(false)
  const [isUpdatingRouteCacheLimit, setIsUpdatingRouteCacheLimit] = useState(false)

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

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshStorageStatus(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshStorageStatus])

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
      setRoutingKeyInput(getLocalOpenRouteServiceApiKey())
    }

    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutingConfig)
    window.addEventListener('storage', refreshRoutingConfig)
    return () => {
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutingConfig)
      window.removeEventListener('storage', refreshRoutingConfig)
    }
  }, [])

  useEffect(() => {
    function refreshGoogleMapsConfig() {
      setGoogleMapsKeyInput(getGoogleMapsApiKey())
      setGoogleMapsConfigured(isGoogleMapsConfigured())
    }

    window.addEventListener(GOOGLE_MAPS_CONFIG_CHANGED_EVENT, refreshGoogleMapsConfig)
    window.addEventListener('storage', refreshGoogleMapsConfig)
    return () => {
      window.removeEventListener(GOOGLE_MAPS_CONFIG_CHANGED_EVENT, refreshGoogleMapsConfig)
      window.removeEventListener('storage', refreshGoogleMapsConfig)
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
          ? '浏览器已授予持久化本地存储。仍建议定期导出 zip 备份。'
          : '浏览器未授予持久化本地存储。请务必导出 zip 备份。',
      )
      await refreshStorageStatus()
    } catch (caught) {
      setPersistenceMessage(caught instanceof Error ? caught.message : '请求持久化本地存储失败。')
    } finally {
      setIsRequestingPersistence(false)
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      setError('请选择一个 zip 备份文件。')
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
      setError(caught instanceof Error ? caught.message : '导入备份失败')
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

  function handleSaveRoutingKey() {
    if (!routingKeyInput.trim()) {
      setRoutingMessage('请输入 OpenRouteService API key。')
      return
    }
    saveLocalOpenRouteServiceApiKey(routingKeyInput)
    setRoutingConfig(getRoutingConfig())
    setRoutingMessage('路线服务 key 已保存到当前浏览器本机。')
  }

  function handleClearRoutingKey() {
    clearLocalOpenRouteServiceApiKey()
    setRoutingKeyInput('')
    setRoutingConfig(getRoutingConfig())
    setRoutingMessage('已清除本机路线服务 key，地图会回到直线连接。')
  }

  function handleSaveGoogleMapsKey() {
    const trimmed = googleMapsKeyInput.trim()
    if (!trimmed) {
      setGoogleMapsMessage('请输入 Google Maps API key。')
      return
    }
    saveGoogleMapsApiKey(trimmed)
    setGoogleMapsConfigured(true)
    setRoutingConfig(getRoutingConfig())
    setGoogleMapsMessage('Google Maps API key 已保存。重新加载页面后生效。')
  }

  function handleClearGoogleMapsKey() {
    clearGoogleMapsApiKey()
    setGoogleMapsKeyInput('')
    setGoogleMapsConfigured(false)
    setRoutingConfig(getRoutingConfig())
    setGoogleMapsMessage('已清除 Google Maps API key，将使用 MapLibre + OpenFreeMap。')
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
    <div className="space-y-5">
      {error || success || warnings.length > 0 ? (
        <Card className="space-y-3">
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

      <Collapsible title="PWA 和离线使用">
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Smartphone className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950">可添加到 iPhone 主屏幕</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                在 iPhone Safari 打开本页面，点分享按钮，再选择“添加到主屏幕”。安装后的应用会自动更新到新版本；如果页面异常，可以关闭后重新打开。
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <InfoPill
              icon={isOnline ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
              text={isOnline ? '当前在线' : '当前离线'}
              tone={isOnline ? 'success' : 'warning'}
            />
            <InfoPill
              icon={<Database className="size-4" />}
              text="已保存的旅行、时间轴、交通段、票据和备份功能依赖本机 IndexedDB。"
            />
            <InfoPill
              icon={<AlertTriangle className="size-4" />}
              text="地图底图和外部 Apple/Google Maps 路线需要网络；本应用不会缓存外部地图资源。"
              tone="warning"
            />
          </div>
        </Card>
      </Collapsible>

      <section className="space-y-3">
        <SectionHeader title="导入备份" />

      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Import className="size-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">导入备份</h3>
            <p className="text-sm text-slate-500">选择之前导出的 travelmap zip 文件。</p>
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">备份文件</span>
          <input
            accept=".zip,application/zip,application/x-zip-compressed"
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700"
            key={fileInputKey}
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>

        {selectedFile ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
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
          导入 zip 备份
        </Button>
      </Card>
      </section>

      <Collapsible title="AI 行程导入">
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950">导入 AI 行程包</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                旅图不会调用 AI。你可以使用 ChatGPT、Claude、Gemini、DeepSeek
                或其他工具生成符合开放格式的 trip-plan.json / trip-plan.zip，然后在本地导入。
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <InfoPill
              icon={<FileJson className="size-4" />}
              text="AI 行程包用于新建旅行；完整备份 zip 仍请使用上方“导入备份”入口。"
            />
            <InfoPill
              icon={<AlertTriangle className="size-4" />}
              text="AI 生成内容可能不准确，导入前请人工核对日期、地点、坐标和交通时间。"
              tone="warning"
            />
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">AI 行程包文件</span>
            <input
              aria-label="选择 AI 行程包文件"
              accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
              className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-violet-700"
              data-testid="ai-trip-plan-file-input"
              key={tripPlanFileInputKey}
              onChange={(event) => void handleTripPlanFileChange(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          {selectedTripPlanFile ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 break-words [overflow-wrap:anywhere]">
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
        </Card>
      </Collapsible>

      <Collapsible title="Google Maps 配置">
        <GoogleMapsSettings
        configured={googleMapsConfigured}
        keyInput={googleMapsKeyInput}
        message={googleMapsMessage}
        onClear={handleClearGoogleMapsKey}
        onKeyInputChange={setGoogleMapsKeyInput}
        onSave={handleSaveGoogleMapsKey}
      />
      </Collapsible>

      <Collapsible title="路线服务配置">
        <RouteServiceSettings
        config={routingConfig}
        keyInput={routingKeyInput}
        cacheError={routeCacheError}
        cacheStats={routeCacheStats}
        isClearingCache={isClearingRouteCache}
        isUpdatingCacheLimit={isUpdatingRouteCacheLimit}
        message={routingMessage}
        onCacheMaxBytesChange={(bytes) => void handleRouteCacheMaxBytesChange(bytes)}
        onClear={handleClearRoutingKey}
        onClearCache={() => void handleClearRouteCache()}
        onKeyInputChange={setRoutingKeyInput}
        onSave={handleSaveRoutingKey}
      />
      </Collapsible>

      <Collapsible title="设备存储">
        <Card className="space-y-3">
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
              detail="浏览器数据、私密浏览、系统清理或长期未使用都可能影响 IndexedDB。"
              icon={<Smartphone className="size-5" />}
              title="本机 IndexedDB"
            />
          </div>

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
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              {persistenceMessage}
            </p>
          ) : null}
        </Card>
      </Collapsible>

      <Collapsible title="关于">
        <Card className="space-y-3 border-amber-100 bg-amber-50/80">
          <div>
            <h3 className="text-base font-semibold text-amber-950">备份提醒</h3>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              重要旅行出发前必须把 zip 保存到 iCloud Drive、OneDrive 或电脑本地。即使浏览器授予持久化存储，iOS Safari
              在存储压力、清除数据、私密浏览或长期未使用时仍可能丢失本地数据。
            </p>
          </div>
          <div className="rounded-xl bg-white/60 px-3 py-2">
            <AppVersion className="text-left text-amber-800/70" label="当前版本" />
          </div>
        </Card>
      </Collapsible>
    </div>
  )
}

function GoogleMapsSettings({
  configured,
  keyInput,
  message,
  onKeyInputChange,
  onSave,
  onClear,
}: {
  configured: boolean
  keyInput: string
  message: string | null
  onKeyInputChange: (value: string) => void
  onSave: () => void
  onClear: () => void
}) {
  return (
    <section className="space-y-3" data-testid="google-maps-settings-section">
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Route className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950">Google Maps API</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              配置后可使用 Google 地图底图、地点搜索和公交路线（含真实公交地铁换乘）。
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <InfoPill
            icon={<AlertTriangle className="size-4" />}
            text="Google Maps API key 会进入前端 bundle。建议在 Google Cloud Console 设置 HTTP 引用限制。"
            tone="warning"
          />
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          当前状态：<span className="font-semibold text-slate-800">{configured ? '已配置' : '未配置'}</span>
          {configured ? (
            <span className="ml-2 text-xs text-slate-400">（底图 + 地点搜索 + 路线规划）</span>
          ) : null}
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Google Maps API Key</span>
          <input
            autoComplete="off"
            className="mt-2 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400"
            data-testid="google-maps-key-input"
            onChange={(event) => onKeyInputChange(event.target.value)}
            placeholder="只保存在当前浏览器本机"
            type="password"
            value={keyInput}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            data-testid="google-maps-key-save"
            icon={<KeyRound className="size-4" />}
            onClick={onSave}
            variant="secondary"
          >
            保存 key
          </Button>
          <Button
            className="w-full"
            data-testid="google-maps-key-clear"
            onClick={onClear}
            variant="ghost"
          >
            清除
          </Button>
        </div>

        {message ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            {message}
          </p>
        ) : null}

        <p className="text-xs leading-5 text-slate-400">
          key 只保存在当前浏览器 localStorage，不会进入备份或云端。需要在 Google Cloud Console 启用 Maps JavaScript API、Places API 和 Routes API。
        </p>
      </Card>
    </section>
  )
}

function RouteServiceSettings({
  config,
  keyInput,
  cacheStats,
  cacheError,
  isClearingCache,
  isUpdatingCacheLimit,
  message,
  onKeyInputChange,
  onSave,
  onClear,
  onCacheMaxBytesChange,
  onClearCache,
}: {
  config: RoutingConfig
  keyInput: string
  cacheStats: RouteCacheStats | null
  cacheError: string | null
  isClearingCache: boolean
  isUpdatingCacheLimit: boolean
  message: string | null
  onKeyInputChange: (value: string) => void
  onSave: () => void
  onClear: () => void
  onCacheMaxBytesChange: (bytes: number) => void
  onClearCache: () => void
}) {
  const configLabel = getRoutingConfigLabel(config)
  const maxOptions = getRouteCacheMaxByteOptions()

  return (
    <section className="space-y-3" data-testid="routing-settings-section">
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Route className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950">道路路线 polyline</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              不配置时，地图继续使用直线连接。配置 OpenRouteService 后，可以在地图页手动生成道路路线。
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <InfoPill
            icon={<AlertTriangle className="size-4" />}
            text="生成道路路线会把地点坐标发送给第三方路线服务；路线仅供参考，不包含实时交通。"
            tone="warning"
          />
          <InfoPill
            icon={<KeyRound className="size-4" />}
            text="VITE_OPENROUTESERVICE_API_KEY 会进入前端 bundle。个人部署可用，公开部署不建议；未来公开服务应使用后端代理。"
            tone="warning"
          />
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          当前状态：<span className="font-semibold text-slate-800">{configLabel}</span>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">本机 OpenRouteService API key</span>
          <input
            autoComplete="off"
            className="mt-2 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400"
            data-testid="routing-api-key-input"
            onChange={(event) => onKeyInputChange(event.target.value)}
            placeholder="只保存在当前浏览器本机"
            type="password"
            value={keyInput}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            data-testid="routing-api-key-save"
            icon={<KeyRound className="size-4" />}
            onClick={onSave}
            variant="secondary"
          >
            保存本机 key
          </Button>
          <Button
            className="w-full"
            data-testid="routing-api-key-clear"
            onClick={onClear}
            variant="ghost"
          >
            清除
          </Button>
        </div>

        {message ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            {message}
          </p>
        ) : null}

        <p className="text-xs leading-5 text-slate-400">
          本机 key 不进入 IndexedDB、zip 备份、Supabase 云备份或 AI 行程包，只保存在当前浏览器 localStorage。
        </p>

        <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-slate-950">路线缓存</h4>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                只缓存道路路线 polyline，不缓存地图瓦片，也不会进入备份或云端。
              </p>
            </div>
            <span
              className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200"
              data-testid="route-cache-count"
            >
              {cacheStats ? `${cacheStats.count} 条` : '读取中'}
            </span>
          </div>

          <div
            className="rounded-xl bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100"
            data-testid="route-cache-stats"
          >
            {cacheStats ? (
              <>
                当前缓存：<span className="font-semibold text-slate-900">{formatFileSize(cacheStats.totalSizeBytes)}</span>
                <span className="text-slate-400"> / </span>
                上限 <span className="font-semibold text-slate-900">{formatFileSize(cacheStats.maxBytes)}</span>
              </>
            ) : (
              '正在读取路线缓存统计…'
            )}
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">缓存上限</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
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
            <p className="break-words rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
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
  if (config.configured && config.source === 'local') {
    return '已使用本机 key'
  }
  if (config.configured && config.source === 'env') {
    return '已通过环境变量配置'
  }
  if (config.provider === 'openrouteservice') {
    return '已选择 OpenRouteService，但尚未配置 key'
  }
  return '未配置，地图使用直线连接'
}

function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const styles =
    tone === 'error'
      ? 'border-red-100 bg-red-50 text-red-600'
      : 'border-emerald-100 bg-emerald-50 text-emerald-700'
  const Icon = tone === 'error' ? AlertTriangle : CheckCircle2

  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-sm font-medium ${styles}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words leading-6 [overflow-wrap:anywhere]">{message}</p>
    </div>
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
      className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4"
      data-testid="ai-trip-plan-guide"
    >
      <div>
        <h4 className="text-base font-semibold text-slate-950">AI 行程包使用说明</h4>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          旅图不会调用 AI，只导入你上传的 JSON / zip。AI 生成的地点、坐标和交通时间都需要人工核对。
        </p>
      </div>

      <div className="space-y-2 text-sm leading-6 text-slate-600">
        <p>
          <span className="font-semibold text-slate-800">JSON 单文件</span>
          ：适合导入行程、地图坐标、交通段，以及 reference / external 票据。
        </p>
        <p>
          <span className="font-semibold text-slate-800">zip 行程包</span>
          ：适合导入行程和 copy 附件。copy 模式必须使用 zip，并通过 filePath 指向 files/ 内附件。
        </p>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl bg-white/80 p-3">
        <pre className="min-w-max text-xs leading-5 text-slate-600">{`trip-plan.zip
├── trip-plan.json
└── files/
    ├── hotel-confirmation.pdf
    └── museum-ticket.png`}</pre>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">可复制给外部 AI 的简化提示词</p>
        <textarea
          className="min-h-40 w-full resize-y rounded-xl border border-violet-100 bg-white/90 px-3 py-3 font-mono text-xs leading-5 text-slate-600 outline-none focus:border-violet-200"
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
          <p className="rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold leading-5 text-violet-700">
            {copyMessage}
          </p>
        ) : null}
      </div>

      <p className="text-xs leading-5 text-slate-500">
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
      className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4"
      data-testid="ai-trip-plan-preview"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600">
          <FileJson className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-violet-600">
            {parsed.sourceKind === 'zip' ? 'zip 行程包' : 'JSON 行程包'}
          </p>
          <h4 className="mt-1 truncate text-base font-semibold text-slate-950">
            {trip?.title || '未命名旅行'}
          </h4>
          <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
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
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-700" role="status">
          可导入：将创建一个新的本地旅行，不会覆盖现有数据。
        </p>
      ) : null}
    </div>
  )
}

function TripPlanSuccessCard({ result }: { result: ImportTripPlanResult }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4"
      data-testid="ai-trip-plan-success-checklist"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600">
          <CheckCircle2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-emerald-700">已导入</p>
          <h4 className="mt-1 break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere]">
            {result.title}
          </h4>
        </div>
      </div>

      <div className="rounded-xl bg-white/80 px-3 py-3 text-sm leading-6 text-emerald-900">
        <p className="font-semibold">建议检查</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>地图坐标是否准确</li>
          <li>交通方式和预计耗时是否合理</li>
          <li>票据是否绑定到正确行程点</li>
          <li>出发前导出完整 zip 备份</li>
        </ol>
      </div>

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
        className: 'border-red-100 bg-red-50 text-red-600',
        text: '有必须修复，无法导入',
      }
    : hasWarnings
      ? {
          className: 'border-amber-100 bg-amber-50 text-amber-800',
          text: '有建议检查，可导入',
        }
      : {
          className: 'border-emerald-100 bg-emerald-50 text-emerald-700',
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
    <div className="rounded-xl bg-white/80 px-3 py-2">
      <p className="text-lg font-semibold text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
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
      ? 'border-red-100 bg-red-50 text-red-600'
      : 'border-amber-100 bg-amber-50 text-amber-800'

  return (
    <div className={`rounded-xl border px-3 py-3 text-sm leading-6 ${styles}`} data-testid={testId}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 opacity-80">{description}</p>
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
    neutral: 'bg-slate-50 text-slate-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-800',
  }[tone]

  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm leading-6 ${styles}`}>
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
    return '已获得持久化存储许可，但仍需要导出 zip 备份'
  }

  if (persisted === false) {
    return '尚未获得持久化存储许可'
  }

  return '持久化存储状态未知'
}

function formatStorageSize(size?: number) {
  if (size === undefined || Number.isNaN(size)) {
    return '未知'
  }

  return formatFileSize(size)
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
