import { ExternalLink, MapPinned, Search } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS } from '../ui/FormField'
import {
  formatAiTripDraftMapDistance,
  type AiTripDraftMissingCoordinateLookupItem,
  type AiTripDraftMapOrderAdjustmentResult,
  type AiTripDraftMapPreviewDay,
} from '../../lib/ai/aiTripDraftMapPreview'
import type { ProviderProxyPlaceLookupResult } from '../../lib/ai/providerProxyContract'
import type { DraftPlaceLookupState } from '../../hooks/useAiDraftController'
import { formatPlaceLookupCandidateCoordinate } from './aiDraftPresentation'

export function AiDraftMapPreviewCard({
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

function formatPlaceLookupCandidateProvider(candidate: ProviderProxyPlaceLookupResult): string {
  if (candidate.provider === 'google_places') return 'Google Places'
  return candidate.provider
}

function formatPlaceLookupCandidateRetrievedAt(candidate: ProviderProxyPlaceLookupResult): string {
  return `来源时间：${candidate.retrievedAt.slice(0, 10)}`
}
