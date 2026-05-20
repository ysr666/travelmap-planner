import { useEffect, useRef } from 'react'
import { formatShortDateWithWeekday } from '../../lib/dates'
import type { Day } from '../../types'

type DaySelectorProps = {
  days: Day[]
  selectedDayId?: string | null
  density?: 'regular' | 'compact'
  onSelectDay: (day: Day) => void
}

export function DaySelector({ days, selectedDayId, density = 'regular', onSelectDay }: DaySelectorProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const isCompact = density === 'compact'

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedDayId])

  return (
    <div className="-mx-4 overflow-x-auto px-4 py-1 app-scrollbar" data-testid="day-selector">
      <div className={`flex min-w-max ${isCompact ? 'gap-1.5' : 'gap-2'}`}>
        {days.map((day, index) => {
          const active = day.id === selectedDayId
          return (
            <button
              className={`${isCompact ? 'min-h-8 rounded-xl px-2.5' : 'min-h-12 rounded-2xl px-3'} text-left transition active:scale-[0.98] ${
                active
                  ? 'bg-primary text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                  : 'tm-surface text-slate-600 dark:text-slate-300'
              }`}
              key={day.id}
              onClick={() => onSelectDay(day)}
              ref={active ? activeRef : undefined}
              type="button"
            >
              <span className={`block font-semibold ${isCompact ? 'text-[11px]' : 'text-sm'}`}>Day {index + 1}</span>
              <span className={`block ${isCompact ? 'text-[10px]' : 'text-xs'} ${active ? 'text-white/80' : 'text-slate-400'}`}>
                {formatShortDay(day.date)}
              </span>
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
