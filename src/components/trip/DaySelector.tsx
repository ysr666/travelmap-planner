import { useEffect, useRef } from 'react'
import { formatShortDateWithWeekday } from '../../lib/dates'
import type { Day } from '../../types'

type DaySelectorProps = {
  days: Day[]
  selectedDayId?: string | null
  density?: 'regular' | 'compact'
  getDayHref?: (day: Day) => string
  onSelectDay: (day: Day) => void
}

export function DaySelector({ days, selectedDayId, density = 'regular', getDayHref, onSelectDay }: DaySelectorProps) {
  const activeRef = useRef<HTMLElement | null>(null)
  const isCompact = density === 'compact'

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedDayId])

  return (
    <div className="-mx-4 overflow-x-auto px-4 py-1 app-scrollbar" data-testid="day-selector">
      <div className={`flex min-w-max ${isCompact ? 'gap-1.5' : 'gap-2'}`}>
        {days.map((day, index) => {
          const active = day.id === selectedDayId
          const className = `${isCompact ? 'min-h-11 rounded-xl px-2.5' : 'min-h-12 rounded-2xl px-3'} text-left transition active:scale-[0.98] ${
            active
              ? 'bg-primary text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
              : 'tm-surface text-on-surface-variant dark:text-outline-variant'
          }`
          const content = (
            <>
              <span className={`block font-semibold ${isCompact ? 'text-[11px]' : 'text-sm'}`}>Day {index + 1}</span>
              <span className={`block ${isCompact ? 'text-[10px]' : 'text-xs'} ${active ? 'text-white' : 'text-on-surface-variant'}`}>
                {formatShortDay(day.date)}
              </span>
            </>
          )
          const ref = active
            ? (node: HTMLElement | null) => {
                activeRef.current = node
              }
            : undefined
          const href = getDayHref?.(day)

          if (href) {
            return (
              <a
                aria-current={active ? 'page' : undefined}
                className={className}
                href={href}
                key={day.id}
                ref={ref}
                role="button"
              >
                {content}
              </a>
            )
          }

          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={className}
              key={day.id}
              onClick={() => onSelectDay(day)}
              ref={ref}
              type="button"
            >
              {content}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatShortDay(date: string) {
  return formatShortDateWithWeekday(date)
}
