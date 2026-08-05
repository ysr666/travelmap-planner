import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Database,
  FileJson,
  Import,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { AppVersion } from '../AppVersion'
import { CloudBackupPanel } from '../cloud/CloudBackupPanel'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { FIELD_LABEL_CLASS } from '../ui/FormField'
import { InlineStatus } from '../ui/InlineStatus'
import { ListRow } from '../ui/ListRow'
import { SkeletonLine } from '../ui/SkeletonLine'
import type { AppearanceMode } from '../../lib/appearance'
import { navigateTo } from '../../lib/routes'
import { formatFileSize } from '../../lib/tickets'
import { getPwaLifecycleStatusLabel } from '../../lib/pwaLifecycle'
import {
  formatStorageSize,
  getPersistenceDetail,
  getPwaLifecycleTone,
  getTripPlanImportButtonLabel,
} from '../../lib/settingsViewModel'
import type {
  SettingsPageController,
  SettingsSection,
} from '../../hooks/useSettingsPageController'
import {
  AiPrivacySettingsPanel,
  InfoPill,
  RouteServiceSettings,
  SettingsIndex,
  StatusMessage,
  TravelProfileSettings,
  TripPlanGuide,
  TripPlanPreview,
  TripPlanSuccessCard,
} from './SettingsSections'

const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: ReactNode }> = [
  { value: 'system', label: '跟随系统', icon: <Monitor className="size-4" /> },
  { value: 'light', label: '白天模式', icon: <Sun className="size-4" /> },
  { value: 'dark', label: '黑夜模式', icon: <Moon className="size-4" /> },
]

export function SettingsPageView({
  controller,
  section,
}: {
  controller: SettingsPageController
  section?: SettingsSection
}) {
  if (!section) return <SettingsIndex />

  const {
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
  } = controller

  return (
    <div className={`mx-auto max-w-3xl ${section === 'advanced' ? 'settings-advanced-stack' : 'space-y-4'}`}>
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

      {section === 'app' ? (
        <section aria-label="外观">
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
        </section>
      ) : null}

      {section === 'preferences' ? <TravelProfileSettings onChange={updateTravelProfile} profile={travelProfile} /> : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="AI 可读取的数据范围" title="AI 与隐私">
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
      ) : null}

      {section === 'app' ? (
        <section aria-label="安装与更新">
          <Card variant="grouped" className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
                <Smartphone className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">安装与更新</h3>
                <p className="mt-1 text-sm leading-6 tm-muted">Safari 分享菜单里添加到主屏幕。</p>
              </div>
            </div>

            <div className="grid gap-2">
              <InfoPill icon={<RefreshCw className="size-4" />} text={`应用更新：${getPwaLifecycleStatusLabel(pwaLifecycle.status)}`} tone={getPwaLifecycleTone(pwaLifecycle.status)} />
              <InfoPill icon={<Smartphone className="size-4" />} text={`当前版本：v${pwaLifecycle.appVersion}`} />
              <InfoPill icon={isOnline ? <Wifi className="size-4" /> : <WifiOff className="size-4" />} text={isOnline ? '当前在线' : '当前离线'} tone={isOnline ? 'success' : 'warning'} />
            </div>

            {pwaLifecycle.message ? <InlineStatus tone={pwaLifecycle.status === 'error' ? 'error' : 'neutral'}>{pwaLifecycle.message}</InlineStatus> : null}
            {pwaLifecycle.status === 'update-ready' ? (
              <Button className="w-full" icon={<RefreshCw className="size-4" />} loading={isApplyingPwaUpdate} onClick={() => void handleApplyPwaUpdate()} variant="secondary">
                更新并重启
              </Button>
            ) : null}
            {pwaUpdateMessage ? <InlineStatus role="status" tone="success">{pwaUpdateMessage}</InlineStatus> : null}
          </Card>
        </section>
      ) : null}

      {section === 'account' ? <CloudBackupPanel trip={contextTrip} /> : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="导入与恢复" title="迁移">
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

            <Button className="w-full" disabled={!selectedFile} icon={<Import className="size-4" />} loading={isImporting} onClick={() => void handleImport()} variant="secondary">
              导入 zip 归档
            </Button>
          </Card>
        </Collapsible>
      ) : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="生成或导入新旅行" title="AI 行程包">
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
              <InfoPill icon={<FileJson className="size-4" />} text="AI 行程包用于新建旅行。" />
              <InfoPill icon={<Sparkles className="size-4" />} text="订单和票据追加到现有旅行，请用旅行收件箱。" />
              <InfoPill icon={<AlertTriangle className="size-4" />} text="导入前核对日期、地点、坐标和交通。" tone="warning" />
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
            <TripPlanGuide copyMessage={copyPromptMessage} onCopyPrompt={() => void handleCopyAiPrompt()} />

            <p className="pt-1 text-center">
              <button type="button" className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-primary underline underline-offset-2" onClick={() => navigateTo('ai-draft')}>
                打开 AI 生成行程 →
              </button>
            </p>
          </Card>
        </Collapsible>
      ) : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="路线服务与缓存" title="路线">
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
      ) : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="缓存和持久化" title="设备存储">
          <Card variant="grouped" className="space-y-3">
            <div className="divide-y divide-slate-100 py-1">
              <ListRow
                detail={storageEstimate ? `已用 ${formatStorageSize(storageEstimate.usage)} / 配额 ${formatStorageSize(storageEstimate.quota)}` : '当前浏览器不支持存储估算'}
                icon={<Database className="size-5" />}
                title="存储估算"
              />
              <ListRow detail={getPersistenceDetail(isPersistenceSupported, persistedStorage)} icon={<ShieldCheck className="size-5" />} title="持久化存储" />
              <ListRow detail="当前设备可离线查看已缓存旅行和票据；清除浏览器数据、私密浏览、系统清理或长期未使用都可能移除这些缓存。" icon={<Smartphone className="size-5" />} title="此设备离线缓存" />
              <ListRow
                detail={ticketCacheSummary ? `${ticketCacheSummary.cachedCount} 个票据缓存，占用 ${formatStorageSize(ticketCacheSummary.cachedSizeBytes)}；其中 ${ticketCacheSummary.clearableCount} 个已同步可清理。` : ticketCacheError ?? '正在统计票据缓存'}
                icon={<FileJson className="size-5" />}
                title="票据离线缓存"
              />
            </div>

            <Button className="w-full" disabled={!ticketCacheSummary?.clearableCount || isClearingTicketCache} icon={<RefreshCw className="size-4" />} loading={isClearingTicketCache} onClick={() => void handleClearSyncedTicketCaches()} variant="secondary">
              清理已同步票据缓存
            </Button>
            <Button className="w-full" disabled={!isPersistenceSupported || persistedStorage === true} icon={<RefreshCw className="size-4" />} loading={isRequestingPersistence} onClick={() => void handleRequestPersistence()} variant="secondary">
              请求持久化本地存储
            </Button>

            {persistenceMessage ? <p className="rounded-xl bg-slate-50/75 px-3 py-2 text-xs leading-5 tm-muted ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70">{persistenceMessage}</p> : null}
            {ticketCacheMessage ? <p className="rounded-xl bg-emerald-50/75 px-3 py-2 text-xs leading-5 text-emerald-800 ring-1 ring-emerald-100/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50">{ticketCacheMessage}</p> : null}
            {ticketCacheError ? <p className="rounded-xl bg-red-50/75 px-3 py-2 text-xs leading-5 text-red-700 ring-1 ring-red-100/70 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50">{ticketCacheError}</p> : null}
          </Card>
        </Collapsible>
      ) : null}

      {section === 'advanced' ? (
        <Collapsible className="settings-advanced-disclosure" subtitle="版本信息" title="关于">
          <Card className="space-y-3 border-amber-100 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/25">
            <div>
              <h3 className="text-base font-semibold text-amber-950 dark:text-amber-200">数据可用性</h3>
              <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-300">登录后旅行会持续同步。离线时可查看已缓存内容，恢复网络后自动继续；zip 归档仅用于迁移。</p>
            </div>
            <div className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-950/35">
              <AppVersion className="text-left text-amber-800/70" label="当前版本" />
            </div>
          </Card>
        </Collapsible>
      ) : null}
    </div>
  )
}
