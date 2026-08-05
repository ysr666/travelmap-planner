import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Compass,
  Copy,
  Database,
  FileJson,
  Route,
  UserRound,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SELECT_CLASS,
  FIELD_TEXTAREA_CLASS,
} from '../ui/FormField'
import { InlineStatus } from '../ui/InlineStatus'
import { ImportRouteGenerationPanel } from '../trip/ImportRouteGenerationPanel'
import type { AiPrivacySettings } from '../../lib/ai/aiPrivacy'
import { navigateTo } from '../../lib/routes'
import { formatFileSize } from '../../lib/tickets'
import {
  buildTripPlanPreviewSummary,
  type ImportTripPlanResult,
  type ParsedTripPlanFile,
} from '../../lib/tripPlanImport'
import { getRouteCacheMaxByteOptions, type RouteCacheStats } from '../../lib/routeCache'
import type { RoutingConfig } from '../../lib/routing'
import {
  type TravelPace,
  type TravelProfile,
  type TravelReminderLevel,
  type TravelTransportPreference,
} from '../../lib/travelProfile'
import { AI_PROMPT_SNIPPET } from '../../hooks/useSettingsPageController'

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

export function SettingsIndex() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="divide-y divide-outline-variant/35 border-y border-outline-variant/35">
        <SettingsMenuRow
          detail="登录与同步"
          icon={<UserRound className="size-5" />}
          onClick={() => navigateTo('settings/account')}
          title="账户与同步"
        />
        <SettingsMenuRow
          detail="节奏、交通和提醒"
          icon={<Compass className="size-5" />}
          onClick={() => navigateTo('settings/preferences')}
          title="旅行偏好"
        />
        <SettingsMenuRow
          detail="外观、安装和通知"
          icon={<Bell className="size-5" />}
          onClick={() => navigateTo('settings/app')}
          title="应用与通知"
        />
        <SettingsMenuRow
          detail="权限、导入和高级选项"
          icon={<Database className="size-5" />}
          onClick={() => navigateTo('settings/advanced')}
          title="数据与高级"
        />
      </div>
    </div>
  )
}

function SettingsMenuRow({
  detail,
  icon,
  onClick,
  title,
}: {
  detail: string
  icon: ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button className="flex min-h-16 w-full items-center gap-3 py-3 text-left tm-focus" onClick={onClick} type="button">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-on-surface">{title}</span>
        <span className="mt-0.5 block text-xs tm-muted">{detail}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
    </button>
  )
}

export function TravelProfileSettings({
  profile,
  onChange,
}: {
  profile: TravelProfile
  onChange: (patch: Partial<TravelProfile>) => void
}) {
  return (
    <section className="space-y-5" data-testid="travel-profile-section">
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
    </section>
  )
}

export function AiPrivacySettingsPanel({
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
      <div className="space-y-4">
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
      </div>
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

export function RouteServiceSettings({
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
          <InfoPill icon={<AlertTriangle className="size-4" />} text="生成路线会发送相邻地点坐标。" tone="warning" />
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

          <Button className="w-full" data-testid="route-cache-clear" loading={isClearingCache} onClick={onClearCache} variant="secondary">
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
  if (config.configured && config.source === 'proxy') return '路线服务由旅图提供'
  if (config.configured && config.source === 'local') return '路线服务由旅图提供'
  if (config.configured && config.source === 'env') return '路线服务由旅图提供'
  return '路线服务暂不可用'
}

export function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return (
    <InlineStatus role={tone === 'error' ? 'alert' : 'status'} size="md" tone={tone}>
      {message}
    </InlineStatus>
  )
}

export function TripPlanGuide({
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
        <p><span className="font-semibold text-slate-800 dark:text-slate-100">JSON 单文件</span>：适合导入行程、地图坐标、交通段，以及 reference / external 票据。</p>
        <p><span className="font-semibold text-slate-800 dark:text-slate-100">zip 行程包</span>：适合导入行程和 copy 附件。copy 模式必须使用 zip，并通过 filePath 指向 files/ 内附件。</p>
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
        <Button className="w-full" data-testid="ai-trip-plan-copy-prompt" icon={<Copy className="size-4" />} onClick={onCopyPrompt} variant="secondary">
          复制给 AI 的提示词
        </Button>
        {copyMessage ? (
          <p className="rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold leading-5 text-violet-700 dark:bg-slate-950/50 dark:text-violet-300">
            {copyMessage}
          </p>
        ) : null}
      </div>

      <p className="text-xs leading-5 tm-muted">完整技术规范请查看 GitHub 仓库 docs/AI_IMPORT_SPEC.md 和 docs/AI_PROMPT_TEMPLATE.md。</p>
    </div>
  )
}

export function TripPlanPreview({ parsed }: { parsed: ParsedTripPlanFile }) {
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
          <p className="text-xs font-semibold text-violet-600 dark:text-violet-300">{parsed.sourceKind === 'zip' ? 'zip 行程包' : 'JSON 行程包'}</p>
          <h4 className="mt-1 truncate text-base font-semibold text-slate-950 dark:text-slate-100">{trip?.title || '未命名旅行'}</h4>
          <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
            {trip?.destination || '目的地未填写'} · {trip?.startDate || '开始日期未定'} - {trip?.endDate || '结束日期未定'}
          </p>
        </div>
      </div>

      <TripPlanValidationStatus hasErrors={hasErrors} hasWarnings={hasWarnings} />

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

      {hasErrors ? <ValidationList description="以下问题会阻止导入，请修改 JSON 或 zip 后重新选择文件。" testId="ai-trip-plan-errors" items={parsed.validation.errors} title="必须修复" tone="error" /> : null}
      {hasWarnings ? <ValidationList description="以下问题不会阻止导入，但建议导入后逐项核对。" testId="ai-trip-plan-warnings" items={parsed.validation.warnings} title="建议检查" tone="warning" /> : null}
      {parsed.validation.valid ? (
        <p className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs font-semibold leading-5 text-emerald-700 ring-1 ring-emerald-100/80 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50" role="status">
          可导入：将创建一个新的本地旅行，不会覆盖现有数据。
        </p>
      ) : null}
    </div>
  )
}

export function TripPlanSuccessCard({ result }: { result: ImportTripPlanResult }) {
  return (
    <div className="space-y-3 rounded-2xl border border-emerald-100/80 bg-emerald-50/80 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/25" data-testid="ai-trip-plan-success-checklist">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/90 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-slate-950/55 dark:text-emerald-300 dark:ring-emerald-900/50">
          <CheckCircle2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">已导入</p>
          <h4 className="mt-1 break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">{result.title}</h4>
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
      {result.warnings.length > 0 ? <ValidationList description="导入已完成，但这些内容仍建议核对。" items={result.warnings} testId="ai-trip-plan-success-warnings" title="建议检查" tone="warning" /> : null}
      <Button className="w-full" onClick={() => navigateTo('trip', { tripId: result.tripId })}>进入旅行工作台</Button>
    </div>
  )
}

function TripPlanValidationStatus({ hasErrors, hasWarnings }: { hasErrors: boolean; hasWarnings: boolean }) {
  const status = hasErrors
    ? { className: 'border-red-100 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300', text: '有必须修复，无法导入' }
    : hasWarnings
      ? { className: 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-300', text: '有建议检查，可导入' }
      : { className: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-300', text: '可导入' }

  return <div aria-live="polite" className={`rounded-xl border px-3 py-2 text-sm font-semibold ${status.className}`} data-testid="ai-trip-plan-validation-status">{status.text}</div>
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
  const styles = tone === 'error'
    ? 'border-red-100 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300'
    : 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-300'

  return (
    <div className={`rounded-xl border px-3 py-3 text-sm leading-6 ${styles}`} data-testid={testId}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5">{description}</p>
      <ul className="mt-2 list-outside list-disc space-y-1 pl-5">
        {items.map((item) => <li className="break-words [overflow-wrap:anywhere]" key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export function InfoPill({
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
