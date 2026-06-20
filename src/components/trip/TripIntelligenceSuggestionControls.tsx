import { Clock3, EyeOff, RotateCcw } from 'lucide-react'
import {
  getTripIntelligenceDispositionPolicy,
  type TripIntelligenceSuggestion,
} from '../../lib/tripIntelligence'

export function TripIntelligenceSuggestionControls({
  onIgnore,
  onLater,
  suggestion,
  tone = 'default',
}: {
  onIgnore?: (suggestion: TripIntelligenceSuggestion) => void
  onLater?: (suggestion: TripIntelligenceSuggestion) => void
  suggestion: TripIntelligenceSuggestion
  tone?: 'default' | 'inverse'
}) {
  const policy = getTripIntelligenceDispositionPolicy(suggestion)
  const colorClass = tone === 'inverse'
    ? 'text-slate-300 hover:bg-white/10 hover:text-white'
    : 'text-on-surface-variant hover:bg-surface-container-high'
  if ((!policy.canIgnore || !onIgnore) && (!policy.canLater || !onLater)) return null
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="trip-intelligence-disposition-controls">
      {policy.canLater && onLater ? (
        <button aria-label={`稍后处理：${suggestion.title}`} className={`flex size-11 items-center justify-center rounded-lg tm-focus ${colorClass}`} onClick={() => onLater(suggestion)} title="24 小时后再次提醒" type="button">
          <Clock3 className="size-4" />
        </button>
      ) : null}
      {policy.canIgnore && onIgnore ? (
        <button aria-label={`忽略建议：${suggestion.title}`} className={`flex size-11 items-center justify-center rounded-lg tm-focus ${colorClass}`} onClick={() => onIgnore(suggestion)} title="忽略这条建议" type="button">
          <EyeOff className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

export function RestoreTripIntelligenceSuggestionButton({ onRestore, suggestion, tone = 'default' }: {
  onRestore: (suggestion: TripIntelligenceSuggestion) => void
  suggestion: TripIntelligenceSuggestion
  tone?: 'default' | 'inverse'
}) {
  const colorClass = tone === 'inverse'
    ? 'text-slate-300 hover:bg-white/10 hover:text-white'
    : 'text-primary hover:bg-surface-container-high'
  return (
    <button aria-label={`恢复建议：${suggestion.title}`} className={`flex size-11 shrink-0 items-center justify-center rounded-lg tm-focus ${colorClass}`} onClick={() => onRestore(suggestion)} title="恢复建议" type="button">
      <RotateCcw className="size-4" />
    </button>
  )
}
