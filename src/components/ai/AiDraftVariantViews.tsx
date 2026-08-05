import { Button } from '../ui/Button'
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS } from '../ui/FormField'
import {
  buildAiTripDraftVariantComparisons,
  buildAiTripDraftVariantMixDays,
  buildDefaultAiTripDraftVariantMixSelection,
  getSelectableAiTripDraftVariantDraft,
  summarizeAiTripDraftVariantDraft,
  type AiTripDraftVariantKind,
  type AiTripDraftVariantState,
} from '../../lib/ai/aiTripDraftVariants'

export function AiDraftVariantComparisonPanel({
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

export function AiDraftVariantCard({
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
