import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Map, MapPin, Ticket } from 'lucide-react'
import type { ReactNode } from 'react'
import { buildDayLiveBriefing, type DayLiveBriefingLine, type DayLiveBriefingModel } from '../../lib/dayLiveBriefing'
import { describeItemTime } from '../../lib/itinerary'
import type { RoutePreparationDay } from '../../lib/routePreparation'
import type { Day, ItineraryItem, Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

type DayLiveBriefingCardProps = {
  day: Day
  items: ItineraryItem[]
  now?: Date
  onOpenItem: (item: ItineraryItem) => void
  onOpenMap: () => void
  onOpenTickets: () => void
  routeDay?: RoutePreparationDay | null
  trip: Trip
}

export function DayLiveBriefingCard({
  day,
  items,
  now,
  onOpenItem,
  onOpenMap,
  onOpenTickets,
  routeDay,
  trip,
}: DayLiveBriefingCardProps) {
  const briefing = buildDayLiveBriefing({
    day,
    items,
    now,
    routeDay,
    trip,
  })
  const canOpenTarget = Boolean(briefing.targetItem)
  const canOpenTickets = Boolean(briefing.targetItem && briefing.targetItem.ticketIds.length > 0)

  return (
    <Card className="space-y-4" data-testid="day-live-briefing-card" variant="grouped">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock3 className="size-4" />
            </span>
            <h3 className="break-words text-base font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">
              下一站提醒
            </h3>
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
              当前 {briefing.currentTimeLabel}
            </span>
          </div>
          <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">{briefing.subtitle}</p>
        </div>
        <StatusPill model={briefing} />
      </div>

      <div className="rounded-xl bg-surface-container-high/70 px-3 py-3">
        <p className="break-words text-base font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">
          {briefing.title}
        </p>
        <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">{briefing.timeLine.text}</p>
        {briefing.targetItem ? (
          <p className="mt-2 break-words text-xs font-semibold text-on-surface-variant [overflow-wrap:anywhere]">
            {describeItemTime(briefing.targetItem)} · {briefing.targetItem.locationName || briefing.targetItem.address || '地点未填写'}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <BriefingLineBlock icon={<MapPin className="size-4" />} line={briefing.locationLine} />
        <BriefingLineBlock icon={<Ticket className="size-4" />} line={briefing.ticketLine} />
        <BriefingLineBlock line={briefing.openingHoursLine} />
        <BriefingLineBlock line={briefing.ticketPriceLine} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <BriefingListBlock emptyLabel="待核对注意事项" lines={briefing.noticeLines} title="注意事项" />
        <BriefingListBlock emptyLabel="暂无路线风险" lines={briefing.routeRiskLines} title="路线风险" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canOpenTarget}
          icon={<ExternalLink className="size-4" />}
          onClick={() => {
            if (briefing.targetItem) {
              onOpenItem(briefing.targetItem)
            }
          }}
          variant="secondary"
        >
          查看详情
        </Button>
        <Button
          disabled={!canOpenTarget}
          icon={<Map className="size-4" />}
          onClick={onOpenMap}
          variant="secondary"
        >
          打开地图
        </Button>
        <Button
          disabled={!canOpenTickets}
          icon={<Ticket className="size-4" />}
          onClick={onOpenTickets}
          variant="secondary"
        >
          查看票据
        </Button>
      </div>
    </Card>
  )
}

function StatusPill({ model }: { model: DayLiveBriefingModel }) {
  const warning = model.status === 'late' || model.routeRiskLines.some((line) => line.tone === 'critical' || line.tone === 'warning')
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
      warning
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
    }`}>
      {warning ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
      {model.status === 'completed' ? '完成态' : warning ? '需核对' : '本地正常'}
    </span>
  )
}

function BriefingLineBlock({ icon, line }: { icon?: ReactNode; line: DayLiveBriefingLine }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-container-high/70 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
        {icon}
        <span>{line.label}</span>
      </p>
      <p className={`mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere] ${
        line.tone === 'critical'
          ? 'text-red-600 dark:text-red-300'
          : line.tone === 'warning'
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-on-surface dark:text-on-surface'
      }`}>
        {line.text}
      </p>
    </div>
  )
}

function BriefingListBlock({
  emptyLabel,
  lines,
  title,
}: {
  emptyLabel: string
  lines: DayLiveBriefingLine[]
  title: string
}) {
  const visibleLines = lines.length > 0 ? lines : [{ id: `${title}-empty`, label: title, text: emptyLabel }]
  return (
    <div className="min-w-0 rounded-lg bg-surface-container-high/70 px-3 py-2">
      <p className="text-xs font-semibold text-on-surface-variant">{title}</p>
      <div className="mt-1 space-y-1">
        {visibleLines.map((line) => (
          <p
            className={`break-words text-sm leading-6 [overflow-wrap:anywhere] ${
              line.tone === 'critical'
                ? 'text-red-600 dark:text-red-300'
                : line.tone === 'warning'
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-on-surface dark:text-on-surface'
            }`}
            key={line.id}
          >
            {line.text}
          </p>
        ))}
      </div>
    </div>
  )
}
