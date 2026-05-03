import { useEffect, useRef } from 'react'
import type { Day } from '../../types'

type DaySelectorProps = {
  days: Day[]
  selectedDayId?: string | null
  onSelectDay: (day: Day) => void
}

export function DaySelector({ days, selectedDayId, onSelectDay }: DaySelectorProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedDayId])

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 app-scrollbar">
      <div className="flex min-w-max gap-2">
        {days.map((day, index) => {
          const active = day.id === selectedDayId
          return (
            <button
              className={`min-h-12 rounded-2xl px-3 text-left transition active:scale-[0.98] ${
                active
                  ? 'bg-[#1677ff] text-white shadow-[0_8px_18px_rgba(22,119,255,0.20)]'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200/80'
              }`}
              key={day.id}
              onClick={() => onSelectDay(day)}
              ref={active ? activeRef : undefined}
              type="button"
            >
              <span className="block text-sm font-semibold">Day {index + 1}</span>
              <span className={`block text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}>
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
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return '日期未定'
  }

  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(parsed)
  const day = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(parsed)
  return `${day} ${weekday}`
}
