import { useEffect, useRef, type ReactNode } from 'react'
import {
  BusFront,
  CarFront,
  Footprints,
  Navigation,
  Plane,
  Plus,
  Ticket,
  TrainFront,
} from 'lucide-react'
import { formatDate, formatShortDate } from '../../lib/dates'
import { describeItemTime, describePreviousTransport } from '../../lib/itinerary'
import type { TripScheduleFocus } from '../../lib/tripScheduleFocus'
import type { Day, ItineraryItem, TransportMode } from '../../types'

type TripScheduleOverviewProps = {
  actions?: ReactNode
  days: Day[]
  focus: TripScheduleFocus | null
  itemsByDay: Record<string, ItineraryItem[]>
  onAddItem: (day: Day) => void
  onOpenItem: (item: ItineraryItem) => void
  onSelectDay: (day: Day) => void
  selectedDayId?: string | null
}

export function TripScheduleOverview({
  actions,
  days,
  focus,
  itemsByDay,
  onAddItem,
  onOpenItem,
  onSelectDay,
  selectedDayId,
}: TripScheduleOverviewProps) {
  return (
    <section className="trip-schedule-overview" aria-label="旅行日程">
      <TripDateStrip
        days={days}
        itemsByDay={itemsByDay}
        onSelectDay={onSelectDay}
        selectedDayId={selectedDayId}
      />
      {focus ? (
        <FocusTimeline
          actions={actions}
          focus={focus}
          onAddItem={onAddItem}
          onOpenItem={onOpenItem}
        />
      ) : null}
    </section>
  )
}

function TripDateStrip({
  days,
  itemsByDay,
  onSelectDay,
  selectedDayId,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onSelectDay: (day: Day) => void
  selectedDayId?: string | null
}) {
  const activeDayRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const activeDay = activeDayRef.current
    if (typeof activeDay?.scrollIntoView !== 'function') return
    activeDay.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
  }, [selectedDayId])

  return (
    <nav aria-label="选择日期" className="trip-date-strip" data-testid="trip-day-selector">
      <div className="trip-date-strip-track app-scrollbar">
        {days.map((day, index) => {
          const itemCount = itemsByDay[day.id]?.length ?? 0
          const active = day.id === selectedDayId
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className="trip-date-option tm-focus"
              data-testid="trip-day-link"
              key={day.id}
              onClick={() => onSelectDay(day)}
              ref={active ? activeDayRef : undefined}
              type="button"
            >
              <span className="trip-date-weekday">{formatWeekday(day.date)}</span>
              <span className="trip-date-number">{formatDayNumber(day.date)}</span>
              <span className="sr-only">
                第 {index + 1} 天 {formatShortDate(day.date)} {day.title} · {itemCount} 个行程点
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function FocusTimeline({
  actions,
  focus,
  onAddItem,
  onOpenItem,
}: {
  actions?: ReactNode
  focus: TripScheduleFocus
  onAddItem: (day: Day) => void
  onOpenItem: (item: ItineraryItem) => void
}) {
  return (
    <section
      aria-label={`${focus.day.title || `第 ${focus.dayIndex + 1} 天`}，${formatDate(focus.day.date)}，${focus.items.length} 个地点`}
      className="trip-focus-day"
      data-testid="trip-home-focus-timeline"
    >
      {focus.items.length === 0 ? (
        <div className="trip-timeline-empty">
          <p>这一天还没有行程点</p>
          <button className="tm-focus" onClick={() => onAddItem(focus.day)} type="button">
            添加第一个地点
          </button>
        </div>
      ) : (
        <>
          <div className="trip-timeline" role="list">
            <div className="trip-timeline-axis" aria-hidden="true" />
            {focus.items.map((item, index) => (
              <button
                className="trip-timeline-row tm-focus"
                key={item.id}
                onClick={() => onOpenItem(item)}
                role="listitem"
                type="button"
              >
                <time>{item.startTime || '--:--'}</time>
                <span className="trip-timeline-node" aria-hidden="true">
                  <span data-active={index === 0 ? 'true' : undefined} />
                </span>
                <span className="trip-timeline-content">
                  <span className="trip-timeline-heading">
                    <strong>{item.title}</strong>
                    {item.ticketIds.length > 0 ? (
                      <span className="trip-timeline-ticket" aria-label={`${item.ticketIds.length} 张票据`}>
                        <Ticket />
                        {item.ticketIds.length}
                      </span>
                    ) : null}
                  </span>
                  <span className="trip-timeline-place">
                    {item.locationName || item.address || describeItemTime(item)}
                  </span>
                  <TransportMeta item={item} />
                </span>
              </button>
            ))}
          </div>
          <div className="trip-timeline-footer">
            <button
              className="trip-timeline-add tm-focus"
              onClick={() => onAddItem(focus.day)}
              type="button"
            >
              <Plus />
              添加行程点
            </button>
            {actions}
          </div>
        </>
      )}
    </section>
  )
}

function TransportMeta({ item }: { item: ItineraryItem }) {
  const description = describePreviousTransport(item)
  if (!description) return null
  return (
    <span className="trip-timeline-transport">
      <TransportIcon mode={item.previousTransportMode} />
      <span>{description}</span>
    </span>
  )
}

function TransportIcon({ mode }: { mode?: TransportMode }) {
  if (mode === 'walk') return <Footprints />
  if (mode === 'train') return <TrainFront />
  if (mode === 'bus' || mode === 'transit') return <BusFront />
  if (mode === 'car') return <CarFront />
  if (mode === 'flight') return <Plane />
  return <Navigation />
}

function formatWeekday(date: string) {
  const value = new Date(`${date}T00:00:00Z`)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' })
    .format(value)
    .replace('周', '')
}

function formatDayNumber(date: string) {
  return String(Number.parseInt(date.slice(8, 10), 10))
}
