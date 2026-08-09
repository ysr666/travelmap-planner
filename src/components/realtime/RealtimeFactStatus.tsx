import { Clock3 } from 'lucide-react'
import { getRealtimeFactFreshness, type RealtimeFactV1 } from '../../lib/realtime'

export type RealtimeFactDisplayState = 'current' | 'stale' | 'unavailable'

type RealtimeFactStatusProps = {
  className?: string
  fact?: RealtimeFactV1
  now: Date | number | string
  state?: RealtimeFactDisplayState
}

export function RealtimeFactStatus({
  className = '',
  fact,
  now,
  state,
}: RealtimeFactStatusProps) {
  const resolvedState = resolveState(fact, state, now)
  if (!fact || resolvedState === 'unavailable') {
    return (
      <span
        className={`inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-5 text-on-surface-variant ${className}`}
        role="status"
      >
        <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">实时信息暂不可用</span>
      </span>
    )
  }

  const source = fact.source.label
  const updated = formatObservedAt(fact.observedAt, now)
  const label = resolvedState === 'stale'
    ? `最近更新 ${source} · ${updated}`
    : `${source} · ${updated}`

  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-5 ${resolvedState === 'stale' ? 'text-tertiary' : 'text-on-surface-variant'} ${className}`}
      data-fact-freshness={resolvedState}
      role="status"
      title={label}
    >
      <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function resolveState(
  fact: RealtimeFactV1 | undefined,
  state: RealtimeFactDisplayState | undefined,
  now: Date | number | string,
): RealtimeFactDisplayState {
  if (state) return state
  if (!fact) return 'unavailable'
  const freshness = getRealtimeFactFreshness(fact, now)
  return freshness === 'future' ? 'unavailable' : freshness
}

function formatObservedAt(observedAt: string, now: Date | number | string) {
  const nowMs = toTimestamp(now)
  const observedMs = Date.parse(observedAt)
  const elapsedMs = Math.max(0, nowMs - observedMs)
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs)) return '更新时间未知'
  if (elapsedMs < 60_000) return '刚刚'
  if (elapsedMs < 60 * 60_000) return `${Math.floor(elapsedMs / 60_000)} 分钟前`
  if (elapsedMs < 24 * 60 * 60_000) return `${Math.floor(elapsedMs / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { day: 'numeric', month: 'short' }).format(new Date(observedMs))
}

function toTimestamp(input: Date | number | string) {
  if (input instanceof Date) return input.getTime()
  return typeof input === 'number' ? input : Date.parse(input)
}
